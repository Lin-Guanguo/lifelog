package dev.linguanguo.lifelog;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Photos for entries: the system photo picker, the system camera (the photo is saved to the gallery),
 * photos shared to LifeLog, the compressed copies in files/media, and the originals' open/share/save.
 * None of it needs a permission.
 */
@CapacitorPlugin(name = "Photos")
public class PhotosPlugin extends Plugin {

    private static final int PICK_MAX = 30;
    private static final String ALBUM = "LifeLog";

    private final List<Uri> shared = new ArrayList<>();
    // A camera photo whose result arrived after Android restarted LifeLog; picked up with the shared photos.
    private Uri restoredCapture;
    private Uri captureUri;

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity != null && collectShared(activity.getIntent())) activity.setIntent(new Intent());
        restorePendingCapture();
    }

    // The camera may run long enough for Android to stop LifeLog; the photo's address is kept on disk so it is
    // not lost: published to the gallery and handed to the app at the next start.
    private SharedPreferences state() {
        return getContext().getSharedPreferences("photos", Context.MODE_PRIVATE);
    }

    private void rememberCapture(Uri uri) {
        state().edit().putString("pendingCapture", uri != null ? uri.toString() : null).apply();
    }

    private void restorePendingCapture() {
        String pending = state().getString("pendingCapture", null);
        if (pending == null) return;
        rememberCapture(null);
        Uri uri = Uri.parse(pending);
        boolean taken;
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            taken = in != null && in.read() >= 0;
        } catch (IOException | RuntimeException e) {
            taken = false;
        }
        if (!taken) {
            discard(uri);
            return;
        }
        publish(uri);
        restoredCapture = uri;
    }

    private void publish(Uri uri) {
        if (Build.VERSION.SDK_INT < 29) return;
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        getContext().getContentResolver().update(uri, done, null, null);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (collectShared(intent)) notifyListeners("shared", new JSObject());
    }

    @SuppressWarnings("deprecation")
    private boolean collectShared(Intent intent) {
        if (intent == null || intent.getType() == null || !intent.getType().startsWith("image/")) return false;
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Parcelable one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one instanceof Uri) uris.add((Uri) one);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Parcelable> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) for (Parcelable p : many) if (p instanceof Uri) uris.add((Uri) p);
        }
        synchronized (shared) {
            shared.addAll(uris);
        }
        return !uris.isEmpty();
    }

    private File mediaDir() throws IOException {
        File dir = new File(getContext().getFilesDir(), "media");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create " + dir);
        return dir;
    }

    private File mediaFile(PluginCall call) throws IOException {
        String name = call.getString("name", "");
        if (!name.matches("[0-9a-f]{32}\\.(webp|jpg)")) throw new IOException("bad file name: " + name);
        return new File(mediaDir(), name);
    }

    // Import

    @PluginMethod
    public void pick(PluginCall call) {
        PickVisualMediaRequest request = new PickVisualMediaRequest.Builder()
            .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
            .build();
        Intent intent = new ActivityResultContracts.PickMultipleVisualMedia(PICK_MAX).createIntent(getContext(), request);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        List<Uri> uris = new ActivityResultContracts.PickMultipleVisualMedia(PICK_MAX).parseResult(result.getResultCode(), result.getData());
        ContentResolver resolver = getContext().getContentResolver();
        for (Uri uri : uris) {
            try {
                // Lets "open/share the original" work later, as long as the photo is still there.
                resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // Not every provider grants lasting access; the photo then acts as a copy only.
            }
        }
        importAll(call, uris, true);
    }

    @PluginMethod
    public void capture(PluginCall call) {
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(new Date());
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, "IMG_" + stamp + ".jpg");
                values.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                captureUri = getContext().getContentResolver().insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
            } else {
                // Older Android: the photo only becomes LifeLog's copy; it is not added to the gallery.
                File file = new File(getContext().getCacheDir(), "capture.jpg");
                captureUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            }
        } catch (RuntimeException e) {
            call.reject("cannot prepare the photo: " + e.getMessage());
            return;
        }
        if (captureUri == null) {
            call.reject("cannot prepare the photo");
            return;
        }
        intent.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
        rememberCapture(captureUri);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "captured");
        } catch (ActivityNotFoundException e) {
            discardCapture();
            call.reject("no camera app");
        }
    }

    @ActivityCallback
    private void captured(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = captureUri;
        captureUri = null;
        rememberCapture(null);
        if (uri == null || result.getResultCode() != Activity.RESULT_OK) {
            discard(uri);
            call.resolve(photos(new JSArray()));
            return;
        }
        publish(uri);
        List<Uri> uris = new ArrayList<>();
        uris.add(uri);
        // Some camera apps report success without writing the photo: then nothing is imported; drop the empty entry.
        importAll(call, uris, Build.VERSION.SDK_INT >= 29, () -> discard(uri));
    }

    private void discardCapture() {
        discard(captureUri);
        captureUri = null;
        rememberCapture(null);
    }

    private void discard(Uri uri) {
        if (uri != null && Build.VERSION.SDK_INT >= 29) {
            try {
                getContext().getContentResolver().delete(uri, null, null);
            } catch (RuntimeException ignored) {
                // Already gone.
            }
        }
    }

    @PluginMethod
    public void takeShared(PluginCall call) {
        List<Uri> uris;
        synchronized (shared) {
            uris = new ArrayList<>(shared);
            shared.clear();
        }
        Uri restored = restoredCapture;
        restoredCapture = null;
        // Access to shared photos ends with this visit, so they are not linked as originals; a restored camera
        // photo is LifeLog's own entry in the gallery, so it is.
        importAll(call, uris, false, null, restored);
    }

    private void importAll(PluginCall call, List<Uri> uris, boolean linkOriginal) {
        importAll(call, uris, linkOriginal, null, null);
    }

    private void importAll(PluginCall call, List<Uri> uris, boolean linkOriginal, Runnable nothingImported) {
        importAll(call, uris, linkOriginal, nothingImported, null);
    }

    private void importAll(PluginCall call, List<Uri> uris, boolean linkOriginal, Runnable nothingImported, Uri ownCapture) {
        getBridge().execute(() -> {
            JSArray list = new JSArray();
            try {
                File dir = mediaDir();
                List<Uri> all = new ArrayList<>(uris);
                if (ownCapture != null) all.add(ownCapture);
                for (Uri uri : all) {
                    try {
                        PhotoImport.Result r = PhotoImport.run(getContext().getContentResolver(), uri, dir);
                        JSObject photo = new JSObject();
                        photo.put("file", r.file);
                        if (r.taken != null) photo.put("taken", r.taken);
                        photo.put("width", r.width);
                        photo.put("height", r.height);
                        if (r.path != null) photo.put("path", r.path);
                        if (linkOriginal || uri == ownCapture) photo.put("uri", uri.toString());
                        list.put(photo);
                    } catch (IOException | RuntimeException e) {
                        // One unreadable photo does not stop the others.
                    }
                }
                if (list.length() == 0 && nothingImported != null) nothingImported.run();
                call.resolve(photos(list));
            } catch (IOException e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    private static JSObject photos(JSArray list) {
        JSObject ret = new JSObject();
        ret.put("photos", list);
        return ret;
    }

    // Copies

    @PluginMethod
    public void list(PluginCall call) {
        try {
            JSArray files = new JSArray();
            File[] all = mediaDir().listFiles();
            if (all != null) {
                for (File f : all) {
                    if (!f.getName().matches("[0-9a-f]{32}\\.(webp|jpg)")) continue;
                    JSObject file = new JSObject();
                    file.put("name", f.getName());
                    file.put("size", f.length());
                    files.put(file);
                }
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        } catch (IOException e) {
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        getBridge().execute(() -> {
            try (InputStream in = new FileInputStream(mediaFile(call))) {
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(readAll(in), Base64.NO_WRAP));
                call.resolve(ret);
            } catch (IOException e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        getBridge().execute(() -> {
            try {
                File out = mediaFile(call);
                File partial = new File(out.getPath() + ".part");
                try (OutputStream stream = new FileOutputStream(partial)) {
                    stream.write(Base64.decode(call.getString("data", ""), Base64.NO_WRAP));
                }
                if (!partial.renameTo(out)) throw new IOException("cannot write " + out);
                call.resolve();
            } catch (IOException | IllegalArgumentException e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void dir(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("path", mediaDir().getAbsolutePath());
            call.resolve(ret);
        } catch (IOException e) {
            call.reject(e.getMessage(), e);
        }
    }

    // Originals

    @PluginMethod
    public void hasOriginal(PluginCall call) {
        String uri = call.getString("uri");
        String file = call.getString("file", "");
        getBridge().execute(() -> {
            boolean ok;
            try {
                ok = uri != null && file.startsWith(PhotoImport.hash(getContext().getContentResolver(), Uri.parse(uri)) + ".");
            } catch (IOException | RuntimeException e) {
                ok = false; // moved, deleted, or access withdrawn
            }
            JSObject ret = new JSObject();
            ret.put("value", ok);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void openOriginal(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse(call.getString("uri", "")), "image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no app to open the photo");
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        try {
            String original = call.getString("uri");
            Uri stream = original != null
                ? Uri.parse(original)
                : FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", mediaFile(call));
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/*");
            send.putExtra(Intent.EXTRA_STREAM, stream);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, null);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (IOException | RuntimeException e) {
            call.reject(e.getMessage());
        }
    }

    /** Saves the copy to the gallery's LifeLog album as a JPEG, with the capture time written back. */
    @PluginMethod
    public void saveCopy(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("needs Android 10 or later");
            return;
        }
        String taken = call.getString("taken");
        getBridge().execute(() -> {
            File jpeg = new File(getContext().getCacheDir(), "save.jpg");
            try {
                File source = mediaFile(call);
                Bitmap bitmap = BitmapFactory.decodeFile(source.getPath());
                if (bitmap == null) throw new IOException("cannot decode " + source.getName());
                try (OutputStream out = new FileOutputStream(jpeg)) {
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out);
                } finally {
                    bitmap.recycle();
                }
                long takenMs = 0;
                if (taken != null && taken.length() >= 19) {
                    ExifInterface exif = new ExifInterface(jpeg.getPath());
                    exif.setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, taken.substring(0, 19).replace('-', ':').replace('T', ' '));
                    if (taken.length() > 19) exif.setAttribute("OffsetTimeOriginal", taken.substring(19));
                    exif.saveAttributes();
                    try {
                        takenMs = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.ROOT).parse(taken).getTime();
                    } catch (java.text.ParseException ignored) {
                        // Left to the gallery.
                    }
                }
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, "LifeLog_" + source.getName().substring(0, 12) + ".jpg");
                values.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM);
                if (takenMs > 0) values.put(MediaStore.Images.ImageColumns.DATE_TAKEN, takenMs);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri target = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
                if (target == null) throw new IOException("cannot add to the gallery");
                try (OutputStream out = resolver.openOutputStream(target); InputStream in = new FileInputStream(jpeg)) {
                    if (out == null) throw new IOException("cannot write to the gallery");
                    out.write(readAll(in));
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(target, done, null, null);
                call.resolve();
            } catch (IOException | RuntimeException e) {
                call.reject(e.getMessage());
            } finally {
                //noinspection ResultOfMethodCallIgnored
                jpeg.delete();
            }
        });
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[64 * 1024];
        for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
        return out.toByteArray();
    }
}
