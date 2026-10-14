# Orbit

A chat app with email-verified accounts and unique, changeable usernames.

The server's development command uses Node's system CA store so SMTP TLS
connections can trust certificate authorities installed in Windows. If email
sending still fails with a certificate-chain error, check whether your network
or antivirus is intercepting SMTP and ensure its trusted root certificate is
installed in Windows. Do not disable TLS certificate verification.

Users can request a password reset from the login screen. Reset links are sent
to verified accounts, expire after one hour, and can only be used once. Password
reset email delivery requires valid Gmail credentials in `server/.env`.