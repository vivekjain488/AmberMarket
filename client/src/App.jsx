import { Navigate, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Market } from "./pages/Market";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/market/:junctionId" element={<Market />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}