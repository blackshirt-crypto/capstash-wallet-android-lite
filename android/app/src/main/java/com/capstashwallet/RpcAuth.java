package com.capstashwallet.lite;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/**
 * Per-install RPC password for the on-device CapStashd node.
 *
 * The node listens on 127.0.0.1:8332, which every app on the phone can reach.
 * A fixed password would let any other app log in and spend the wallet, so each
 * install generates its own random password and keeps it in app-private storage
 * (getFilesDir), which other apps cannot read.
 */
public final class RpcAuth {

    public static final String RPC_USER = "capstash";

    private static final String PASSWORD_FILE = "rpc_password";

    private RpcAuth() {}

    public static synchronized String getPassword(Context context) throws IOException {
        File file = new File(context.getFilesDir(), PASSWORD_FILE);

        if (file.exists()) {
            try (FileInputStream in = new FileInputStream(file)) {
                byte[] buf = new byte[(int) file.length()];
                int read = in.read(buf);
                String saved = new String(buf, 0, Math.max(read, 0), StandardCharsets.UTF_8).trim();
                if (saved.length() >= 32) return saved;
            }
        }

        // 32 random bytes -> 64 hex characters
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        String password = sb.toString();

        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(password.getBytes(StandardCharsets.UTF_8));
        }
        file.setReadable(false, false);
        file.setReadable(true, true);
        return password;
    }
}
