package dev.linguanguo.lifelog;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
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
import java.util.Map;

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
    // A camera photo that arrived after Android restarted LifeLog; handed over with the shared photos.
    private File restoredCapture;

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity != null && collectShared(activity.getIntent())) activity.setIntent(new Intent());
        restoredCapture = pendingCapture();
    }

    // The camera writes into LifeLog's cache through its FileProvider, which every camera app supports (writing
    // into a pending gallery entry owned by LifeLog is not: some cameras report success and save nothing).
    // LifeLog then adds the photo to the gallery itself. A flag on disk keeps the photo if Android stops LifeLog
    // while the camera is open.
    private File captureFile() {
        return new File(getContext().getCacheDir(), "capture.jpg");
    }

    private SharedPreferences state() {
        return getContext().getSharedPreferences("photos", Context.MODE_PRIVATE);
    }

    private void rememberCapture(boolean pending) {
        state().edit().putBoolean("pendingCapture", pending).apply();
    }

    private File pendingCapture() {
        if (!state().getBoolean("pendingCapture", false)) return null;
        rememberCapture(false);
        File file = captureFile();
        return file.length() > 0 ? file : null;
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
        File file = captureFile();
        if (file.exists() && !file.delete()) {
            call.reject("cannot prepare the photo");
            return;
        }
        Uri output;
        try {
            output = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        } catch (IllegalArgumentException e) {
            call.reject("cannot prepare the photo: " + e.getMessage());
            return;
        }
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, output);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        rememberCapture(true);
        try {
            startActivityForResult(call, intent, "captured");
        } catch (ActivityNotFoundException e) {
            rememberCapture(false);
            call.reject("no camera app");
        }
    }

    @ActivityCallback
    private void captured(PluginCall call, ActivityResult result) {
        if (call == null) return; // LifeLog was restarted meanwhile: load() picked the photo up
        rememberCapture(false);
        File file = captureFile();
        if (result.getResultCode() != Activity.RESULT_OK) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            call.resolve(photos(new JSArray()));
            return;
        }
        if (file.length() == 0) {
            call.reject("the camera app returned no photo");
            return;
        }
        importAll(call, new ArrayList<>(), false, file);
    }

    @PluginMethod
    public void takeShared(PluginCall call) {
        List<Uri> uris;
        synchronized (shared) {
            uris = new ArrayList<>(shared);
            shared.clear();
        }
        File restored = restoredCapture;
        restoredCapture = null;
        // Access to shared photos ends with this visit, so they are not linked as originals.
        importAll(call, uris, false, restored);
    }

    private void importAll(PluginCall call, List<Uri> uris, boolean linkOriginal) {
        importAll(call, uris, linkOriginal, null);
    }

    /** Imports the photos; `capture` is a camera photo in the cache, first added to the gallery (its original). */
    private void importAll(PluginCall call, List<Uri> uris, boolean linkOriginal, File capture) {
        getBridge().execute(() -> {
            JSArray list = new JSArray();
            String captureError = null;
            try {
                File dir = mediaDir();
                for (Uri uri : uris) {
                    try {
                        list.put(describe(PhotoImport.run(getContext().getContentResolver(), uri, dir), linkOriginal ? uri : null));
                    } catch (IOException | RuntimeException e) {
                        // One unreadable photo does not stop the others.
                    }
                }
                if (capture != null) {
                    try {
                        // Read from the camera's file: the gallery entry's location would be removed for LifeLog.
                        PhotoImport.Result r = PhotoImport.run(getContext().getContentResolver(), Uri.fromFile(capture), dir);
                        String name = "IMG_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(new Date()) + ".jpg";
                        Uri original = Build.VERSION.SDK_INT >= 29 ? addToGallery(capture, name, "image/jpeg", 0) : null;
                        r.path = original != null ? Environment.DIRECTORY_PICTURES + "/" + ALBUM + "/" + name : null;
                        r.meta.putIfAbsent("format", "jpeg"); // the camera writes JPEG; a cache file has no type
                        list.put(describe(r, original));
                    } catch (IOException | RuntimeException e) {
                        captureError = e.getMessage();
                    } finally {
                        //noinspection ResultOfMethodCallIgnored
                        capture.delete();
                    }
                }
                if (list.length() == 0 && captureError != null) call.reject(captureError);
                else call.resolve(photos(list));
            } catch (IOException e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    private static JSObject describe(PhotoImport.Result r, Uri original) {
        JSObject photo = new JSObject();
        photo.put("file", r.file);
        if (r.taken != null) photo.put("taken", r.taken);
        photo.put("width", r.width);
        photo.put("height", r.height);
        if (r.path != null) photo.put("path", r.path);
        if (!r.meta.isEmpty()) {
            JSObject meta = new JSObject();
            for (Map.Entry<String, String> field : r.meta.entrySet()) meta.put(field.getKey(), field.getValue());
            photo.put("meta", meta);
        }
        if (original != null) photo.put("uri", original.toString());
        return photo;
    }

    /** Adds a file to the gallery's LifeLog album (Android 10+), dated by takenMs if given, else by its EXIF. */
    private Uri addToGallery(File source, String name, String mime, long takenMs) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(new Date());
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name != null ? name : "IMG_" + stamp + ".jpg");
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM);
        if (takenMs > 0) values.put(MediaStore.Images.ImageColumns.DATE_TAKEN, takenMs);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri target = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
        if (target == null) throw new IOException("cannot add to the gallery");
        try {
            try (OutputStream out = resolver.openOutputStream(target); InputStream in = new FileInputStream(source)) {
                if (out == null) throw new IOException("cannot write to the gallery");
                byte[] buffer = new byte[64 * 1024];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(target, done, null, null);
            return target;
        } catch (IOException | RuntimeException e) {
            resolver.delete(target, null, null);
            throw e;
        }
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
                    file.put("modified", f.lastModified());
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
    public void remove(PluginCall call) {
        try {
            File file = mediaFile(call);
            if (file.exists() && !file.delete()) throw new IOException("cannot delete " + file.getName());
            call.resolve();
        } catch (IOException e) {
            call.reject(e.getMessage(), e);
        }
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

    /** The copy saved to the gallery: the copy's own file, named by the whole key (LifeLog_<key>.webp). */
    private static String savedName(String file) {
        return "LifeLog_" + file;
    }

    private String displayName(Uri uri) {
        try (android.database.Cursor cursor = getContext().getContentResolver()
            .query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
            return cursor != null && cursor.moveToFirst() ? cursor.getString(0) : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** A saved copy, or one saved by 0.4.1–0.4.2 as JPEG under the first 12 characters of the key. */
    private Uri savedCopy(String file) {
        Uri saved = inAlbum(savedName(file));
        return saved != null || file.length() < 12 ? saved : inAlbum("LifeLog_" + file.substring(0, 12) + ".jpg");
    }

    /** A photo with this name in the gallery's LifeLog album (only LifeLog's own entries are visible), or null. */
    private Uri inAlbum(String displayName) {
        if (Build.VERSION.SDK_INT < 29 || displayName == null) return null;
        Uri images = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        String[] projection = { MediaStore.MediaColumns._ID };
        String where = MediaStore.MediaColumns.DISPLAY_NAME + " = ? AND " + MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?";
        String[] args = { displayName, Environment.DIRECTORY_PICTURES + "/" + ALBUM + "%" };
        try (android.database.Cursor cursor = getContext().getContentResolver().query(images, projection, where, args, null)) {
            if (cursor != null && cursor.moveToFirst()) return ContentUris.withAppendedId(images, cursor.getLong(0));
        } catch (RuntimeException ignored) {
            // Treated as not there.
        }
        return null;
    }

    /**
     * What LifeLog's album holds of this photo: the original (a camera photo, by its file name, checked by hash) or a
     * saved copy. Finds originals whose remembered link is gone (e.g. app data cleared); after a reinstall Android no
     * longer shows LifeLog the files its earlier install made.
     */
    @PluginMethod
    public void inAlbum(PluginCall call) {
        String file = call.getString("name", "");
        String original = call.getString("original");
        getBridge().execute(() -> {
            JSObject ret = new JSObject();
            try {
                Uri uri = inAlbum(original);
                if (uri != null && file.startsWith(PhotoImport.hash(getContext().getContentResolver(), uri) + ".")) {
                    ret.put("original", uri.toString());
                }
            } catch (IOException | RuntimeException ignored) {
                // Not the same photo, or unreadable.
            }
            Uri saved = file.length() > 12 ? savedCopy(file) : null;
            if (saved != null) ret.put("saved", saved.toString());
            call.resolve(ret);
        });
    }

    /** Saves the copy to the gallery's LifeLog album as it is (WebP), dated by the capture time, unless it is there. */
    @PluginMethod
    public void saveCopy(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("needs Android 10 or later");
            return;
        }
        String taken = call.getString("taken");
        getBridge().execute(() -> {
            try {
                File source = mediaFile(call);
                Uri existing = savedCopy(source.getName());
                if (existing != null) {
                    JSObject ret = new JSObject();
                    ret.put("existed", true);
                    ret.put("uri", existing.toString());
                    call.resolve(ret);
                    return;
                }
                long takenMs = 0;
                if (taken != null) {
                    try {
                        takenMs = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.ROOT).parse(taken).getTime();
                    } catch (java.text.ParseException ignored) {
                        // Left to the gallery.
                    }
                }
                // The copy has no EXIF; the gallery's date taken is set instead.
                String mime = source.getName().endsWith(".jpg") ? "image/jpeg" : "image/webp";
                String name = savedName(source.getName());
                Uri saved = addToGallery(source, name, mime, takenMs);
                JSObject ret = new JSObject();
                // A file of that name LifeLog cannot see (made before a reinstall) makes Android rename this one
                // ("… (1).webp"): it was saved before, so the new one is removed again.
                if (!name.equals(displayName(saved))) {
                    getContext().getContentResolver().delete(saved, null, null);
                    ret.put("existed", true);
                    call.resolve(ret);
                    return;
                }
                ret.put("existed", false);
                ret.put("uri", saved.toString());
                call.resolve(ret);
            } catch (IOException | RuntimeException e) {
                call.reject(e.getMessage());
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
