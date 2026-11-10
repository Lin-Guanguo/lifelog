package dev.linguanguo.lifelog;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Photos for entries. Every photo handed to LifeLog (system document picker, system camera, Share → LifeLog) is kept
 * as its complete original in the app's private files/media, which the gallery never sees. The originals can be
 * opened or shared with other apps, and exported to the gallery's LifeLog album on request. No permission needed.
 */
@CapacitorPlugin(name = "Photos")
public class PhotosPlugin extends Plugin {

    private static final String ALBUM = "LifeLog";
    private static final String NAME = "[0-9a-f]{32}\\.(jpg|png|webp|heic|avif|gif)";

    // Photo files go to and from the server here, streamed, so large originals never have to fit in memory.
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build();

    private final List<Uri> shared = new ArrayList<>();
    // A camera photo that arrived after Android restarted LifeLog; handed over with the shared photos.
    private File restoredCapture;

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity != null && collectShared(activity.getIntent())) activity.setIntent(new Intent());
        restoredCapture = pendingCapture();
        // Copies cut short (the app was stopped mid-import or mid-download) are never used; clear them.
        File[] parts = new File(getContext().getFilesDir(), "media").listFiles((dir, name) -> name.endsWith(".part"));
        if (parts != null) for (File part : parts) //noinspection ResultOfMethodCallIgnored
            part.delete();
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
        if (!name.matches(NAME)) throw new IOException("bad file name: " + name);
        return new File(mediaDir(), name);
    }

    private static String mime(String name) {
        String ext = name.substring(name.lastIndexOf('.') + 1);
        return "jpg".equals(ext) ? "image/jpeg" : "image/" + ext;
    }

    // Adding photos

    /** The system document picker: it hands over the files themselves (the photo picker on some phones hands over copies). */
    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            startActivityForResult(call, intent, "picked");
        } catch (ActivityNotFoundException e) {
            call.reject("no document picker");
        }
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        List<Uri> uris = new ArrayList<>();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
        }
        importAll(call, uris, null);
    }

    // The camera writes into LifeLog's cache through its FileProvider, which every camera app supports; the photo is
    // then kept like any other. A flag on disk keeps it if Android stops LifeLog while the camera is open.
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
        importAll(call, new ArrayList<>(), file);
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
        importAll(call, uris, restored);
    }

    /** Keeps each photo's original; `capture` is a camera photo in the cache, deleted once kept. */
    private void importAll(PluginCall call, List<Uri> uris, File capture) {
        getBridge().execute(() -> {
            JSArray list = new JSArray();
            String error = null;
            try {
                File dir = mediaDir();
                List<Uri> all = new ArrayList<>(uris);
                if (capture != null) all.add(Uri.fromFile(capture));
                for (Uri uri : all) {
                    try {
                        list.put(describe(PhotoImport.run(getContext().getContentResolver(), uri, dir)));
                    } catch (IOException | RuntimeException e) {
                        error = e.getMessage(); // one unreadable photo does not stop the others
                    }
                }
                if (capture != null) {
                    //noinspection ResultOfMethodCallIgnored
                    capture.delete();
                }
                if (list.length() == 0 && error != null) call.reject(error);
                else call.resolve(photos(list));
            } catch (IOException e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    private static JSObject describe(PhotoImport.Result r) {
        JSObject photo = new JSObject();
        photo.put("file", r.file);
        if (r.taken != null) photo.put("taken", r.taken);
        if (r.width > 0 && r.height > 0) {
            photo.put("width", r.width);
            photo.put("height", r.height);
        }
        if (!r.meta.isEmpty()) {
            JSObject meta = new JSObject();
            for (Map.Entry<String, String> field : r.meta.entrySet()) meta.put(field.getKey(), field.getValue());
            photo.put("meta", meta);
        }
        return photo;
    }

    private static JSObject photos(JSArray list) {
        JSObject ret = new JSObject();
        ret.put("photos", list);
        return ret;
    }

    // Files

    @PluginMethod
    public void list(PluginCall call) {
        try {
            JSArray files = new JSArray();
            File[] all = mediaDir().listFiles();
            if (all != null) {
                for (File f : all) {
                    if (!f.getName().matches(NAME)) continue;
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
                ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(Integer.MAX_VALUE, mediaFile(call).length()));
                byte[] buffer = new byte[64 * 1024];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                call.resolve(ret);
            } catch (IOException | OutOfMemoryError e) {
                call.reject(e.getMessage());
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

    /** Deletes a photo and its preview, unless it was written (or added again) at or after keepSince. */
    @PluginMethod
    public void remove(PluginCall call) {
        Long keepSince = call.getLong("keepSince");
        try {
            File file = mediaFile(call);
            if (keepSince != null && file.lastModified() >= keepSince) {
                call.resolve();
                return;
            }
            if (file.exists() && !file.delete()) throw new IOException("cannot delete " + file.getName());
            //noinspection ResultOfMethodCallIgnored
            PhotoImport.previewFile(file, previewDir()).delete();
            call.resolve();
        } catch (IOException e) {
            call.reject(e.getMessage(), e);
        }
    }

    private File previewDir() {
        return new File(getContext().getCacheDir(), "previews");
    }

    private static Map<String, String> headers(PluginCall call) {
        Map<String, String> headers = new java.util.HashMap<>();
        JSObject js = call.getObject("headers", new JSObject());
        for (java.util.Iterator<String> keys = js.keys(); keys.hasNext(); ) {
            String key = keys.next();
            headers.put(key, js.getString(key));
        }
        return headers;
    }

    private static JSObject status(int code) {
        JSObject ret = new JSObject();
        ret.put("status", code);
        return ret;
    }

    /** PUTs a photo file to the server, streamed from disk. Resolves to the HTTP status. */
    @PluginMethod
    public void upload(PluginCall call) {
        String url = call.getString("url");
        Map<String, String> headers = headers(call);
        getBridge().execute(() -> {
            try {
                File file = mediaFile(call);
                String type = headers.get("Content-Type");
                RequestBody body = RequestBody.create(file, type != null ? MediaType.parse(type) : null);
                Request.Builder request = new Request.Builder().url(url).put(body);
                for (Map.Entry<String, String> h : headers.entrySet()) request.header(h.getKey(), h.getValue());
                try (Response response = http.newCall(request.build()).execute()) {
                    call.resolve(status(response.code()));
                }
            } catch (IOException | RuntimeException e) {
                call.reject(e.getMessage());
            }
        });
    }

    /** GETs a photo file from the server into media/, streamed to disk. Resolves to the HTTP status. */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        Map<String, String> headers = headers(call);
        getBridge().execute(() -> {
            File partial = null;
            try {
                File file = mediaFile(call);
                Request.Builder request = new Request.Builder().url(url).get();
                for (Map.Entry<String, String> h : headers.entrySet()) request.header(h.getKey(), h.getValue());
                try (Response response = http.newCall(request.build()).execute()) {
                    ResponseBody body = response.body();
                    if (response.code() == 200 && body != null) {
                        partial = new File(file.getPath() + ".part");
                        try (InputStream in = body.byteStream(); OutputStream out = new FileOutputStream(partial)) {
                            byte[] buffer = new byte[64 * 1024];
                            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                        }
                        if (!partial.renameTo(file)) throw new IOException("cannot write " + file);
                    }
                    call.resolve(status(response.code()));
                }
            } catch (IOException | RuntimeException e) {
                if (partial != null) //noinspection ResultOfMethodCallIgnored
                    partial.delete();
                call.reject(e.getMessage());
            }
        });
    }

    /** The file to display for a photo kept here (the original, or a local preview of it); not there → no path. */
    @PluginMethod
    public void preview(PluginCall call) {
        getBridge().execute(() -> {
            try {
                File original = mediaFile(call);
                JSObject ret = new JSObject();
                if (original.exists()) {
                    ret.put("path", PhotoImport.preview(original, previewDir()).getAbsolutePath());
                }
                call.resolve(ret);
            } catch (IOException | RuntimeException e) {
                call.reject(e.getMessage());
            }
        });
    }

    // Open, share, export

    private Uri shareable(File file) {
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
    }

    /** Opens the photo with another app: its copy in the gallery when exported, else the original kept here. */
    @PluginMethod
    public void open(PluginCall call) {
        try {
            File file = mediaFile(call);
            Uri exported = exported(file.getName());
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(exported != null ? exported : shareable(file), mime(file.getName()));
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(view);
            call.resolve();
        } catch (IOException | RuntimeException e) {
            call.reject(e instanceof ActivityNotFoundException ? "no app to open the photo" : e.getMessage());
        }
    }

    /** Shares the original kept here. */
    @PluginMethod
    public void share(PluginCall call) {
        try {
            File file = mediaFile(call);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime(file.getName()));
            send.putExtra(Intent.EXTRA_STREAM, shareable(file));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, null);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (IOException | RuntimeException e) {
            call.reject(e.getMessage());
        }
    }

    /** Whether the photo was exported to the gallery's LifeLog album. */
    @PluginMethod
    public void isExported(PluginCall call) {
        String name = call.getString("name", "");
        getBridge().execute(() -> {
            JSObject ret = new JSObject();
            ret.put("value", name.matches(NAME) && exported(name) != null);
            call.resolve(ret);
        });
    }

    /** Exports the original to the gallery's LifeLog album as LifeLog_<file>, dated by its capture time, unless it is there. */
    @PluginMethod
    public void export(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("needs Android 10 or later");
            return;
        }
        String taken = call.getString("taken");
        getBridge().execute(() -> {
            try {
                File source = mediaFile(call);
                JSObject ret = new JSObject();
                if (exported(source.getName()) != null) {
                    ret.put("existed", true);
                    call.resolve(ret);
                    return;
                }
                long takenMs = 0;
                if (taken != null) {
                    try {
                        takenMs = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.ROOT).parse(taken).getTime();
                    } catch (java.text.ParseException ignored) {
                        // Left to the gallery, which reads the file's EXIF.
                    }
                }
                String name = exportName(source.getName());
                Uri saved = addToGallery(source, name, mime(source.getName()), takenMs);
                // A file of that name LifeLog cannot see (made before a reinstall) makes Android rename this one
                // ("… (1)"): it was exported before, so the new one is removed again.
                if (!name.equals(displayName(saved))) {
                    getContext().getContentResolver().delete(saved, null, null);
                    ret.put("existed", true);
                } else {
                    ret.put("existed", false);
                }
                call.resolve(ret);
            } catch (IOException | RuntimeException e) {
                call.reject(e.getMessage());
            }
        });
    }

    private static String exportName(String file) {
        return "LifeLog_" + file;
    }

    /** The exported copy, or null; for a 0.4.x .webp copy also the 12-character JPEG name 0.4.1–0.4.2 used. */
    private Uri exported(String file) {
        Uri uri = inAlbum(exportName(file));
        return uri != null || !file.endsWith(".webp") ? uri : inAlbum("LifeLog_" + file.substring(0, 12) + ".jpg");
    }

    private Uri inAlbum(String displayName) {
        if (Build.VERSION.SDK_INT < 29) return null;
        Uri images = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        String where = MediaStore.MediaColumns.DISPLAY_NAME + " = ? AND " + MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?";
        String[] args = { displayName, Environment.DIRECTORY_PICTURES + "/" + ALBUM + "%" };
        try (Cursor cursor = getContext().getContentResolver().query(images, new String[] { MediaStore.MediaColumns._ID }, where, args, null)) {
            if (cursor != null && cursor.moveToFirst()) return ContentUris.withAppendedId(images, cursor.getLong(0));
        } catch (RuntimeException ignored) {
            // Treated as not there.
        }
        return null;
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
            return cursor != null && cursor.moveToFirst() ? cursor.getString(0) : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Adds a file to the gallery's LifeLog album (Android 10+), dated by takenMs if given, else by its EXIF. */
    private Uri addToGallery(File source, String name, String mime, long takenMs) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
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
}
