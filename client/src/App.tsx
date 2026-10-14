import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type Message = {
  id: number;
  text: string;
  sender: "me" | "other";
};

const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:3000";

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const USERNAME_RULES =
  "Username must be 3–20 characters: letters, numbers, and underscores only.";

export default function App() {
  const [isLogin, setIsLogin] = useState(true);
  const [showChat, setShowChat] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Username editing (chat screen)
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [isSavingUsername, setIsSavingUsername] = useState(false);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatTitle, setChatTitle] = useState("General chat");

  useEffect(() => {
    let active = true;

    fetch(`${API_URL}/api/auth/me`, {
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (active && data?.user?.email) {
          setEmail(data.user.email);
          setUsername(data.user.username ?? "");
          setShowChat(true);
        }
      })
      .catch(() => {
        // The user is not logged in, or the server is unavailable.
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setAuthNotice("");

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.trim();

    if (!isLogin && !USERNAME_PATTERN.test(trimmedUsername)) {
      setAuthError(USERNAME_RULES);
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      setAuthError("Your passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setAuthError("Your password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);

    try {
      const endpoint = isLogin ? "login" : "register";

      const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: trimmedUsername,
          email: normalizedEmail,
          password,
          confirmPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setAuthError(
          data.error ?? "Something went wrong. Please try again."
        );
        return;
      }

      if (!isLogin) {
        setEmail(normalizedEmail);
        setUsername("");
        setPassword("");
        setConfirmPassword("");
        setIsLogin(true);
        setAuthNotice(
          data.message ??
            "Check your email for your verification link."
        );
        return;
      }

      setEmail(data.user.email);
      setUsername(data.user.username ?? "");
      setPassword("");
      setConfirmPassword("");
      setShowChat(true);
    } catch {
      setAuthError(
        "Could not connect to the server. Make sure your backend is running."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function logout() {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      setAuthError("Could not contact the server to log out.");
    }

    setShowChat(false);
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setMessage("");
    setMessages([]);
    setIsEditingUsername(false);
    setUsernameError("");
    setAuthError("");
    setAuthNotice("");
  }

  function switchAuthMode() {
    setIsLogin((previous) => !previous);
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setAuthError("");
    setAuthNotice("");
  }

  function startEditingUsername() {
    setNewUsername(username);
    setUsernameError("");
    setIsEditingUsername(true);
  }

  function cancelEditingUsername() {
    setIsEditingUsername(false);
    setUsernameError("");
  }

  async function saveUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUsernameError("");

    const trimmed = newUsername.trim();

    if (!USERNAME_PATTERN.test(trimmed)) {
      setUsernameError(USERNAME_RULES);
      return;
    }

    if (trimmed === username) {
      setIsEditingUsername(false);
      return;
    }

    setIsSavingUsername(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/username`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: trimmed }),
      });

      const data = await response.json();

      if (!response.ok) {
        setUsernameError(
          data.error ?? "Couldn't update your username."
        );
        return;
      }

      setUsername(data.user.username);
      setIsEditingUsername(false);
    } catch {
      setUsernameError("Could not connect to the server.");
    } finally {
      setIsSavingUsername(false);
    }
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

  if (showChat) {
    return (
      <main className="chat-page">
        <header className="chat-header">
          <div className="chat-brand">
            <div className="brand-icon">O</div>
            <span>Orbit</span>
          </div>

          <div className="chat-user">
            <span className="user-avatar">
              {(username || email).charAt(0).toUpperCase() || "U"}
            </span>

            {isEditingUsername ? (
              <form className="username-form" onSubmit={saveUsername}>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(event) => setNewUsername(event.target.value)}
                  minLength={3}
                  maxLength={20}
                  pattern="[a-zA-Z0-9_]{3,20}"
                  title={USERNAME_RULES}
                  aria-label="New username"
                  autoFocus
                  required
                />
                <button type="submit" disabled={isSavingUsername}>
                  {isSavingUsername ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  className="username-cancel"
                  onClick={cancelEditingUsername}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <span className="user-identity">
                <strong className="user-name">@{username}</strong>
                <span className="user-email">{email}</span>
              </span>
            )}

            {!isEditingUsername && (
              <button
                className="logout-button"
                type="button"
                onClick={startEditingUsername}
              >
                Edit username
              </button>
            )}

            <button className="logout-button" onClick={logout}>
              Log out
            </button>
          </div>

          {usernameError && (
            <p className="auth-error username-error" role="alert">
              {usernameError}
            </p>
          )}
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
                  <h3>Welcome to Orbit, {username}!</h3>
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
          <div className="brand-icon">O</div>
          <span>Orbit</span>
        </div>

        <div className="auth-heading">
          <h1>{isLogin ? "Welcome back" : "Create your account"}</h1>
          <p>
            {isLogin
              ? "Log in to continue your conversations."
              : "Join Orbit and start connecting."}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <>
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                placeholder="your_username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]{3,20}"
                title={USERNAME_RULES}
                required
              />
            </>
          )}

          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
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
            maxLength={72}
            required
          />

          {!isLogin && (
            <>
              <label htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
              />
            </>
          )}

          {authError && (
            <p className="auth-error" role="alert">
              {authError}
            </p>
          )}

          {authNotice && (
            <p className="auth-notice" role="status">
              {authNotice}
            </p>
          )}

          {isLogin && (
            <button
              className="forgot-link"
              type="button"
              onClick={() =>
                setAuthError("Password recovery has not been set up yet.")
              }
            >
              Forgot password?
            </button>
          )}

          <button
            className="submit-button"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Please wait..."
              : isLogin
                ? "Log in"
                : "Create account"}
          </button>
        </form>

        <div className="auth-switch">
          <span>
            {isLogin ? "Don't have an account?" : "Already have an account?"}
          </span>
          <button type="button" onClick={switchAuthMode}>
            {isLogin ? "Sign up" : "Log in"}
          </button>
        </div>

        <p className="auth-footer">Orbit · A place to connect and chat.</p>
      </section>
    </main>
  );
}
