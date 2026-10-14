# Orbit

A chat app with email-verified accounts with unique, changeable usernames.

Email is optional at signup. Accounts with an email use verification and can
recover access by password reset. Leaving email blank starts a username-only
guest session that lasts until logout or seven days, whichever comes first;
guest sessions have no password and cannot be recovered.

General chat uses Socket.IO to deliver messages live to other connected users.
Messages are not saved, so users must be online in the chat at the same time.
Each active login session gets a balanced pastel color for other users' message
bubbles; the color stays with that session until logout or expiry.
