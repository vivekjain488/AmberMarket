import { useState } from "react";
import { Button } from "./components/ui/button";

function App() {
  const [message, setMessage] = useState("");

  return (
    <div>
      <h1>Hello World</h1>
      <Button onClick={() => setMessage("you wanted this boilerplate in typescript? you bloody masochist")}>
        Click me
      </Button>
      {message && <p>{message}</p>}
    </div>
  )
}

export default App;