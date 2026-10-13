
import { useState } from "react";
import "./App.css";

type Message = {
  id: number;
  sender: string;
  text: string;
};

export default function App() {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!message.trim() || !username.trim()) return;

    setMessages((previous) => [
      ...previous,
      {
        id: Date.now(),
        sender: username.trim(),
        text: message.trim(),
      },
    ]);

    setMessage("");
  }

  return (
    <main className="chat-app">
      <header className="chat-header">
        <div className="logo">C</div>
        <div>
          <h1>Yapper</h1>
          <p>Your place to Yap.</p>
        </div>
        <span className="status">● Online</span>
      </header>

      <section className="chat-body">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="chat-icon">✉</div>
            <h2>Welcome to Yapper</h2>
            <p>Your conversation starts here.</p>
          </div>
        ) : (
          messages.map((item) => (
            <article className="message" key={item.id}>
              <strong>{item.sender}</strong>
              <p>{item.text}</p>
            </article>
          ))
        )}
      </section>

      <form className="chat-form" onSubmit={sendMessage}>
        <input
          aria-label="Your username"
          placeholder="Your name"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />

        <input
          aria-label="Message"
          placeholder="Write a message..."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
        />

        <button type="submit">Send ↑</button>
      </form>
    </main>
  );
}