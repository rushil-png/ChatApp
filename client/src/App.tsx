
import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  autoConnect: false,
});

export default function App() {
  const [status, setStatus] = useState("Disconnected");

  useEffect(() => {
    const onConnect = () => setStatus("Connected");
    const onDisconnect = () => setStatus("Disconnected");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.disconnect();
    };
  }, []);

  return (
    <main style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>ChatApp</h1>
      <p>Socket status: {status}</p>
    </main>
  );
}