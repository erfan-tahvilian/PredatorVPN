// SPDX-License-Identifier: GPL-3.0-or-later
package com.foxvpn.android;

import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Looper;
import android.util.Base64;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import java.io.IOException;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

// Display only the provider's bounded image CAPTCHA inside the native app.
// Credentials and challenge tokens are never passed to a browser or WebView.
final class CaptchaPrompt {
    private static final Set<String> TYPES = Set.of(
        "data:image/png;base64", "data:image/jpeg;base64",
        "data:image/webp;base64", "data:image/gif;base64");

    private CaptchaPrompt() { }

    static String request(MainActivity activity, String uri) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper())
            throw new IOException("Cannot wait for CAPTCHA on the UI thread");
        if (uri == null || uri.length() > 768 * 1024)
            throw new IOException("CAPTCHA image is invalid");
        int comma = uri.indexOf(',');
        if (comma < 0 || !TYPES.contains(uri.substring(0, comma)))
            throw new IOException("Unsupported CAPTCHA image");
        final byte[] encoded;
        try {
            encoded = Base64.decode(uri.substring(comma + 1), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            throw new IOException("CAPTCHA image could not be decoded");
        }
        if (encoded.length == 0 || encoded.length > 512 * 1024)
            throw new IOException("CAPTCHA image is too large");

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(encoded, 0, encoded.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 ||
            (long) bounds.outWidth * bounds.outHeight > 6_000_000L)
            throw new IOException("CAPTCHA image dimensions are invalid");
        Bitmap bitmap = BitmapFactory.decodeByteArray(encoded, 0, encoded.length);
        if (bitmap == null) throw new IOException("CAPTCHA image could not be displayed");

        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        AtomicReference<AlertDialog> pendingDialog = new AtomicReference<>();
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) {
                completed.countDown();
                return;
            }
            LinearLayout layout = new LinearLayout(activity);
            layout.setOrientation(LinearLayout.VERTICAL);
            int pad = Math.round(16 * activity.getResources().getDisplayMetrics().density);
            layout.setPadding(pad, pad, pad, 0);
            ImageView preview = new ImageView(activity);
            preview.setImageBitmap(bitmap);
            preview.setAdjustViewBounds(true);
            preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
            layout.addView(preview, new LinearLayout.LayoutParams(-1, Math.round(180 * activity.getResources().getDisplayMetrics().density)));
            EditText input = new EditText(activity);
            input.setHint("Characters in the image");
            input.setSingleLine(true);
            input.setMaxLines(1);
            input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(80)});
            layout.addView(input, new LinearLayout.LayoutParams(-1, -2));
            AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("Verify your account")
                .setMessage("Enter the text shown by the account provider to continue signing in.")
                .setView(layout)
                .setPositiveButton("Submit", (d, which) -> result.set(input.getText().toString().trim()))
                .setNegativeButton("Cancel", null).create();
            pendingDialog.set(dialog);
            dialog.setOnDismissListener(d -> completed.countDown());
            dialog.show();
        });
        if (!completed.await(120, TimeUnit.SECONDS)) {
            activity.runOnUiThread(() -> {
                AlertDialog dialog = pendingDialog.get();
                if (dialog != null && dialog.isShowing()) dialog.dismiss();
            });
            throw new IOException("Account verification timed out");
        }
        String answer = result.get();
        if (answer == null || answer.isEmpty())
            throw new IOException("Account verification was canceled");
        return answer;
    }
}
