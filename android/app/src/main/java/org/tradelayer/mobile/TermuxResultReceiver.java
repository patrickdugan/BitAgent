package org.tradelayer.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class TermuxResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        TermuxBridge.dispatchResult(intent);
    }
}
