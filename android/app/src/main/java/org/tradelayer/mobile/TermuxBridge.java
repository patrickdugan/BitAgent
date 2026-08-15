package org.tradelayer.mobile;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.content.ContextCompat;

import java.lang.ref.WeakReference;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;

final class TermuxBridge {
    static final String TERMUX_PACKAGE = "com.termux";
    static final String RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND";
    static final String LOCAL_BITAGENT_URL = "http://127.0.0.1:8787";

    private static final String RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService";
    private static final String ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND";
    private static final String EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH";
    private static final String EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS";
    private static final String EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR";
    private static final String EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND";
    private static final String EXTRA_SESSION_ACTION = "com.termux.RUN_COMMAND_SESSION_ACTION";
    private static final String EXTRA_COMMAND_LABEL = "com.termux.RUN_COMMAND_COMMAND_LABEL";
    private static final String EXTRA_COMMAND_DESCRIPTION = "com.termux.RUN_COMMAND_COMMAND_DESCRIPTION";
    private static final String EXTRA_COMMAND_HELP = "com.termux.RUN_COMMAND_COMMAND_HELP";
    private static final String EXTRA_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT";
    private static final String EXTRA_RESULT_BUNDLE = "result";
    private static final String EXTRA_RESULT_STDOUT = "stdout";
    private static final String EXTRA_RESULT_STDERR = "stderr";
    private static final String EXTRA_RESULT_EXIT_CODE = "exitCode";
    private static final String EXTRA_RESULT_ERR = "err";
    private static final String EXTRA_RESULT_ERRMSG = "errmsg";
    private static final String EXTRA_COMMAND_ID = "org.tradelayer.mobile.TERMUX_COMMAND_ID";
    private static final String RESULT_ACTION = "org.tradelayer.mobile.TERMUX_RESULT";
    private static final String TERMUX_HOME = "~/";
    private static final String HERMES = "$PREFIX/bin/hermes";
    private static final String BITAGENT = "$PREFIX/bin/bitagent-android";
    private static final String HELP_URL =
        "https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent";
    private static final AtomicInteger NEXT_REQUEST_CODE = new AtomicInteger(4100);
    private static WeakReference<ResultListener> listener = new WeakReference<>(null);

    enum Command {
        HERMES_VERSION("hermes_version", HERMES, new String[]{"version"}, true, true,
            "Check Hermes", "Read the installed Hermes CLI version."),
        HERMES_DOCTOR("hermes_doctor", HERMES, new String[]{"doctor"}, true, true,
            "Hermes doctor", "Run the official Hermes diagnostics without opening a chat."),
        HERMES_OPEN("hermes_open", HERMES, new String[0], false, false,
            "Open Hermes", "Open an interactive Hermes terminal. The wallet app does not receive the transcript."),
        BITAGENT_SKILL_INSTALL("bitagent_skill_install", BITAGENT,
            new String[]{"install-hermes-skill"}, true, true,
            "Install BitAgent skill", "Install the reviewed candidate-only BitAgent skill into Hermes."),
        BITAGENT_START("bitagent_start", BITAGENT, new String[]{"start"}, true, true,
            "Start BitAgent", "Start the loopback-only BitAgent service on port 8787."),
        BITAGENT_STATUS("bitagent_status", BITAGENT, new String[]{"status"}, true, true,
            "Check BitAgent", "Check the loopback-only BitAgent service on port 8787.");

        final String id;
        final String path;
        final String[] arguments;
        final boolean background;
        final boolean receivesResult;
        final String label;
        final String description;

        Command(
            String id,
            String path,
            String[] arguments,
            boolean background,
            boolean receivesResult,
            String label,
            String description
        ) {
            this.id = id;
            this.path = path;
            this.arguments = arguments;
            this.background = background;
            this.receivesResult = receivesResult;
            this.label = label;
            this.description = description;
        }

        static Command fromId(String id) {
            return Arrays.stream(values()).filter(command -> command.id.equals(id)).findFirst().orElse(null);
        }
    }

    interface ResultListener {
        void onTermuxResult(Result result);
    }

    static final class Result {
        final Command command;
        final boolean ok;
        final int exitCode;
        final String summary;

        Result(Command command, boolean ok, int exitCode, String summary) {
            this.command = command;
            this.ok = ok;
            this.exitCode = exitCode;
            this.summary = summary;
        }
    }

    static void setResultListener(ResultListener resultListener) {
        listener = new WeakReference<>(resultListener);
    }

    static boolean isInstalled(Context context) {
        try {
            context.getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
    }

    static boolean hasPermission(Context context) {
        return ContextCompat.checkSelfPermission(context, RUN_COMMAND_PERMISSION)
            == PackageManager.PERMISSION_GRANTED;
    }

    static void openTermux(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(TERMUX_PACKAGE);
        if (launch == null) throw new IllegalStateException("Termux is not installed.");
        context.startActivity(launch);
    }

    static void run(Context context, Command command) {
        if (!isInstalled(context)) throw new IllegalStateException("Install Termux from F-Droid first.");
        if (!hasPermission(context)) {
            throw new SecurityException("Grant this app the Termux RUN_COMMAND additional permission first.");
        }

        Intent intent = buildIntent(context, command, NEXT_REQUEST_CODE.getAndIncrement());
        context.startService(intent);
    }

    static Intent buildIntent(Context context, Command command, int requestCode) {
        Intent intent = new Intent();
        intent.setClassName(TERMUX_PACKAGE, RUN_COMMAND_SERVICE);
        intent.setAction(ACTION_RUN_COMMAND);
        intent.putExtra(EXTRA_COMMAND_PATH, command.path);
        intent.putExtra(EXTRA_ARGUMENTS, command.arguments.clone());
        intent.putExtra(EXTRA_WORKDIR, TERMUX_HOME);
        intent.putExtra(EXTRA_BACKGROUND, command.background);
        intent.putExtra(EXTRA_SESSION_ACTION, "0");
        intent.putExtra(EXTRA_COMMAND_LABEL, command.label);
        intent.putExtra(EXTRA_COMMAND_DESCRIPTION, command.description);
        intent.putExtra(EXTRA_COMMAND_HELP, HELP_URL);

        if (command.receivesResult) {
            Intent resultIntent = new Intent(context, TermuxResultReceiver.class);
            resultIntent.setAction(RESULT_ACTION);
            resultIntent.putExtra(EXTRA_COMMAND_ID, command.id);
            int flags = PendingIntent.FLAG_ONE_SHOT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent result = PendingIntent.getBroadcast(context, requestCode, resultIntent, flags);
            intent.putExtra(EXTRA_PENDING_INTENT, result);
        }
        return intent;
    }

    static void dispatchResult(Intent intent) {
        if (intent == null || !RESULT_ACTION.equals(intent.getAction())) return;
        Command command = Command.fromId(intent.getStringExtra(EXTRA_COMMAND_ID));
        Bundle bundle = intent.getBundleExtra(EXTRA_RESULT_BUNDLE);
        if (command == null || bundle == null) return;

        int exitCode = bundle.getInt(EXTRA_RESULT_EXIT_CODE, -1);
        int internalError = bundle.getInt(EXTRA_RESULT_ERR, Activity.RESULT_CANCELED);
        String stdout = bundle.getString(EXTRA_RESULT_STDOUT, "");
        String stderr = bundle.getString(EXTRA_RESULT_STDERR, "");
        String internalMessage = bundle.getString(EXTRA_RESULT_ERRMSG, "");
        boolean ok = internalError == Activity.RESULT_OK && exitCode == 0;
        String summary = concise(stdout);
        if (summary.isBlank()) summary = concise(stderr);
        if (summary.isBlank()) summary = concise(internalMessage);
        if (summary.isBlank()) summary = ok ? "Command completed." : "Command failed.";

        ResultListener active = listener.get();
        if (active != null) active.onTermuxResult(new Result(command, ok, exitCode, summary));
    }

    private static String concise(String value) {
        String clean = value == null ? "" : value.replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", "").trim();
        if (clean.isBlank()) return "";
        String[] lines = clean.split("\\R");
        String last = lines[lines.length - 1].trim();
        return last.length() <= 240 ? last : last.substring(0, 240) + "…";
    }

    private TermuxBridge() {}
}
