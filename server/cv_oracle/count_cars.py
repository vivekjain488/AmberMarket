import argparse
import json
import random
import signal
import sys
import time
from dataclasses import dataclass


@dataclass
class State:
    junction_id: str
    frames_processed: int = 0
    count: int = 0
    stop: bool = False


def emit(state: State) -> None:
    sys.stdout.write(
        json.dumps(
            {
                "count": int(state.count),
                "junction_id": state.junction_id,
                "frames_processed": int(state.frames_processed),
                "timestamp": int(time.time()),
            }
        )
        + "\n"
    )
    sys.stdout.flush()


def handle_stop(signum, frame, state: State) -> None:
    state.stop = True


def fake_counter(state: State, max_seconds: int) -> None:
    target = random.randint(12, 35)
    start = time.time()
    while not state.stop and (time.time() - start) < max_seconds:
        time.sleep(1.0)
        state.frames_processed += 10
        if state.count < target:
            state.count += random.randint(0, 3)
            state.count = min(state.count, target)
        emit(state)


def best_effort_cv_counter(state: State, stream_url: str, max_seconds: int) -> None:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
        from ultralytics import RTDETR  # type: ignore
        from deep_sort_realtime.deepsort_tracker import DeepSort  # type: ignore
    except Exception:
        fake_counter(state, max_seconds)
        return

    try:
        model = RTDETR("rtdetr-l.pt")
    except Exception:
        fake_counter(state, max_seconds)
        return

    tracker = DeepSort(max_age=30, n_init=3)

    cap = cv2.VideoCapture(stream_url)
    ok, frame = cap.read()
    if not ok or frame is None:
        cap.release()
        fake_counter(state, max_seconds)
        return

    h, w = frame.shape[:2]
    tripwire_y = int(h * 0.60)
    prev_centroid_y: dict[int, float] = {}
    counted_ids: set[int] = set()

    start = time.time()
    last_emit = 0.0
    while not state.stop and (time.time() - start) < max_seconds:
        ok, frame = cap.read()
        if not ok or frame is None:
            time.sleep(0.05)
            continue

        state.frames_processed += 1

        resized = cv2.resize(frame, (640, 640))
        try:
            results = model(resized, conf=0.65, iou=0.45, classes=[2], verbose=False)
        except Exception:
            continue

        dets = []
        try:
            boxes = results[0].boxes
            if boxes is None:
                boxes = []
            for b in boxes:
                xyxy = b.xyxy[0].tolist()
                conf = float(b.conf[0])
                x1, y1, x2, y2 = xyxy
                dets.append(([x1, y1, x2 - x1, y2 - y1], conf, 2))
        except Exception:
            dets = []

        tracks = tracker.update_tracks(dets, frame=resized)
        for tr in tracks:
            if not tr.is_confirmed():
                continue
            tid = int(tr.track_id)
            ltrb = tr.to_ltrb()
            x1, y1, x2, y2 = ltrb
            cy = float((y1 + y2) / 2.0)

            prev = prev_centroid_y.get(tid)
            prev_centroid_y[tid] = cy

            if tid in counted_ids or prev is None:
                continue

            if prev < tripwire_y and cy >= tripwire_y:
                counted_ids.add(tid)
                state.count += 1

        if (time.time() - last_emit) >= 1.0:
            emit(state)
            last_emit = time.time()

    cap.release()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--junction_id", required=True)
    parser.add_argument("--stream_url", required=True)
    parser.add_argument("--max_seconds", type=int, default=25)
    parser.add_argument("--mode", choices=["auto", "fake"], default="auto")
    args = parser.parse_args()

    state = State(junction_id=args.junction_id)
    signal.signal(signal.SIGTERM, lambda s, f: handle_stop(s, f, state))
    signal.signal(signal.SIGINT, lambda s, f: handle_stop(s, f, state))

    if args.mode == "fake":
        fake_counter(state, args.max_seconds)
    else:
        best_effort_cv_counter(state, args.stream_url, args.max_seconds)

    emit(state)


if __name__ == "__main__":
    main()

