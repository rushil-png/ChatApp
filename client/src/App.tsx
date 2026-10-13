
import { useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type Message = {
  id: number;
  text: string;
  sender: "me" | "other";
};

export default function App() {
  const [isLogin, setIsLogin] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatTitle, setChatTitle] = useState("General chat");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Demo only: authentication is not connected to a server yet.
    setShowChat(true);
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = message.trim();
    if (!text) return;

    setMessages((previous) => [
      ...previous,
      { id: Date.now(), text, sender: "me" },
    ]);

    setMessage("");
  }

  function logout() {
    setShowChat(false);
    setPassword("");
    setMessage("");
  }

  if (showChat) {
    return (
      <main className="chat-page">
        <header className="chat-header">
          <div className="chat-brand">
            <div className="brand-icon">C</div>
            <span>ChatApp</span>
          </div>

          <div className="chat-user">
            <span className="user-avatar">
              {email.charAt(0).toUpperCase() || "U"}
            </span>
            <span className="user-email">{email}</span>
            <button className="logout-button" onClick={logout}>
              Log out
            </button>
          </div>
        </header>

        <div className="chat-layout">
          <aside className="chat-sidebar">
            <h2>Messages</h2>

            <button
              className="conversation active"
              onClick={() => setChatTitle("General chat")}
            >
              <span className="conversation-avatar">G</span>
              <span>
                <strong>General chat</strong>
                <small>Chat with everyone</small>
              </span>
            </button>

            <p className="sidebar-note">
              More conversations can be added later.
            </p>
          </aside>

          <section className="chat-room">
            <div className="room-header">
              <div>
                <h2>{chatTitle}</h2>
                <p>Your space to connect</p>
              </div>

              <span className="online-indicator">
                <span />
                Demo mode
              </span>
            </div>

            <div className="message-list">
              {messages.length === 0 ? (
                <div className="empty-chat">
                  <div className="empty-chat-icon">✦</div>
                  <h3>Welcome to ChatApp!</h3>
                  <p>Send a message to get your conversation started.</p>
                </div>
              ) : (
                messages.map((item) => (
                  <div
                    key={item.id}
                    className={`message-row ${
                      item.sender === "me" ? "my-message" : ""
                    }`}
                  >
                    <div className="message-bubble">{item.text}</div>
                  </div>
                ))
              )}
            </div>

            <form className="message-form" onSubmit={sendMessage}>
              <input
                type="text"
                placeholder="Write a message..."
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={2000}
                aria-label="Write a message"
              />

              <button type="submit" disabled={!message.trim()}>
                Send <span>➤</span>
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-icon">C</div>
          <span>ChatApp</span>
        </div>

        <div className="auth-heading">
          <h1>{isLogin ? "Welcome back" : "Create your account"}</h1>
          <p>
            {isLogin
              ? "Log in to continue your conversations."
              : "Join ChatApp and start connecting."}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isLogin ? "current-password" : "new-password"}
            minLength={8}
            required
          />

          {isLogin && (
            <button
              className="forgot-link"
              type="button"
              onClick={() =>
                alert("Password recovery will be added later.")
              }
            >
              Forgot password?
            </button>
          )}

          <button className="submit-button" type="submit">
            {isLogin ? "Log in" : "Create account"}
          </button>
        </form>

        <div className="auth-switch">
          <span>
            {isLogin
              ? "Don't have an account?"
              : "Already have an account?"}
          </span>

          <button
            type="button"
            onClick={() => setIsLogin((previous) => !previous)}
          >
            {isLogin ? "Sign up" : "Log in"}
          </button>
        </div>

        <p className="auth-footer">
          ChatApp · A place to connect and chat.
        </p>
      </section>
    </main>
  );
}