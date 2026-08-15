# Hermes + Termux bridge

TradeLayer Mobile can use Termux's official `RUN_COMMAND` service to start a
small, reviewed set of Android-local operations:

- read `hermes version`;
- run `hermes doctor`;
- open an interactive Hermes session without returning its transcript to the
  wallet app;
- install the repository's candidate-only BitAgent Hermes skill;
- start or inspect the loopback BitAgent service; and
- connect the BitAgent WebView to `http://127.0.0.1:8787`.

No arbitrary command, command argument, stdin payload, wallet secret, RPC
credential, approval, signature, transaction, or broadcast is accepted from
web content or from a model. There is still no JavaScript-to-native bridge.

## Phone setup

1. Install Termux from F-Droid. Keep Termux and any Termux plug-ins from the
   same signing source.
2. In Termux, enable the external-command API in
   `~/.termux/termux.properties`:

   ```properties
   allow-external-apps=true
   ```

   Then run `termux-reload-settings` or restart Termux.
3. Install Hermes using the official Android/Termux path. The app's Hermes tab
   can copy the current command for you:

   ```bash
   curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
   hermes version
   hermes doctor
   ```

4. Put this BitAgent repository in Termux. The launcher recognizes either
   `~/BitAgent/apps/bitagent-launch-kernel` or
   the same path with an additional `BitAgent` component. For another location,
   set `BITAGENT_ANDROID_ROOT` in the Termux environment.
5. Install the Node dependencies and reviewed launcher:

   ```bash
   cd ~/BitAgent/apps/bitagent-launch-kernel
   npm ci
   install -m 700 ~/BitAgent/android/termux/bitagent-android "$PREFIX/bin/bitagent-android"
   ```

6. Open TradeLayer Mobile's **Hermes** tab. Grant the app's additional
   **Run commands in Termux environment** permission. Android may place it
   under App info > Permissions > Additional permissions.
7. Tap **Check Hermes version**, **Install BitAgent skill for Hermes**, then
   **Start local BitAgent**. After **Check local BitAgent** reports ready, tap
   **Connect BitAgent tab to localhost**.

The installed Hermes skill lives at
`~/.hermes/skills/bitagent-android/SKILL.md`. Its helper exposes workflow reads,
planning, DAG task creation, and candidate validation only. When approval is
next, Hermes must stop and return control to the wallet/user boundary.

## Operational limits

- Hermes on Termux is an upstream Tier-2 path. Docker isolation, the standard
  local voice stack, and automatic browser setup are not part of the tested
  Android bundle.
- Android may suspend Termux background work. The launcher is suitable for a
  foreground/demo phone; durable production service management remains an
  operator responsibility.
- Loopback cleartext is allowed only for `127.0.0.1` and `localhost`. Remote
  BitAgent release origins still require HTTPS; LAN cleartext remains blocked.
- The app does not install Hermes automatically. It copies the official command
  so the user can review and run it in Termux.

References:

- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/getting-started/termux.md
- https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent
