package dev.linguanguo.lifelog;

import android.content.ContentResolver;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * Keeps a photo's original: copies it byte for byte into media/<key>.<ext>, where key is the first 32 hex digits of
 * the SHA-256 of its bytes and ext comes from its content. Reads what the photo line records about it (capture time,
 * size, EXIF facts). Also makes the local display preview (a cache, never synced).
 */
final class PhotoImport {

    static final int PREVIEW_SIDE = 1600;
    static final int PREVIEW_QUALITY = 80;

    static final class Result {
        String file;
        String taken; // ISO 8601 with offset, or null
        int width; // as displayed (EXIF rotation applied); 0 when unknown
        int height;
        final Map<String, String> meta = new LinkedHashMap<>(); // more facts (photo line fields), in order
    }

    private PhotoImport() {}

    static Result run(ContentResolver resolver, Uri uri, File mediaDir) throws IOException {
        File part = File.createTempFile("import", ".part", mediaDir);
        MessageDigest digest = sha256();
        byte[] head = new byte[64];
        int headLength = 0;
        long bytes = 0;
        try (InputStream in = open(resolver, uri); OutputStream out = new FileOutputStream(part)) {
            byte[] buffer = new byte[64 * 1024];
            for (int n; (n = in.read(buffer)) > 0; ) {
                if (headLength < head.length) {
                    int take = Math.min(head.length - headLength, n);
                    System.arraycopy(buffer, 0, head, headLength, take);
                    headLength += take;
                }
                digest.update(buffer, 0, n);
                out.write(buffer, 0, n);
                bytes += n;
            }
        } catch (IOException | RuntimeException e) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw e;
        }
        String ext = extension(head, headLength);
        if (ext == null) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new IOException("not a supported image");
        }

        Result result = new Result();
        result.file = hex(digest.digest()).substring(0, 32) + "." + ext;
        File out = new File(mediaDir, result.file);
        if (out.exists()) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            // Added again: counts as new, so cleanup at sync does not remove it before it is used.
            //noinspection ResultOfMethodCallIgnored
            out.setLastModified(System.currentTimeMillis());
        } else if (!part.renameTo(out)) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new IOException("cannot write " + out);
        }

        // Facts come from the kept file itself (seekable, so HEIF works too).
        int orientation = ExifInterface.ORIENTATION_NORMAL;
        try {
            ExifInterface exif = new ExifInterface(out.getPath());
            orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            result.taken = takenFromExif(exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL), exif.getAttribute("OffsetTimeOriginal"));
            readMeta(exif, result.meta);
        } catch (IOException | RuntimeException ignored) {
            // Not every image has readable EXIF.
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(out.getPath(), bounds);
        if (bounds.outWidth > 0 && bounds.outHeight > 0) {
            boolean turned = turned(orientation);
            result.width = turned ? bounds.outHeight : bounds.outWidth;
            result.height = turned ? bounds.outWidth : bounds.outHeight;
        }
        if (result.taken == null) result.taken = providerDate(resolver, uri);
        result.meta.put("format", "jpg".equals(ext) ? "jpeg" : ext);
        result.meta.put("bytes", Long.toString(bytes));
        return result;
    }

    /** The image type from the file's first bytes; null when it is not one LifeLog keeps. */
    static String extension(byte[] h, int n) {
        if (n >= 3 && (h[0] & 0xff) == 0xff && (h[1] & 0xff) == 0xd8 && (h[2] & 0xff) == 0xff) return "jpg";
        if (n >= 4 && (h[0] & 0xff) == 0x89 && h[1] == 'P' && h[2] == 'N' && h[3] == 'G') return "png";
        if (n >= 4 && h[0] == 'G' && h[1] == 'I' && h[2] == 'F' && h[3] == '8') return "gif";
        if (n >= 12 && h[0] == 'R' && h[1] == 'I' && h[2] == 'F' && h[3] == 'F' && h[8] == 'W' && h[9] == 'E' && h[10] == 'B' && h[11] == 'P') {
            return "webp";
        }
        if (n >= 12 && h[4] == 'f' && h[5] == 't' && h[6] == 'y' && h[7] == 'p') {
            // The major brand, then the compatible ones: an AVIF may declare "mif1" first and "avif" among the others.
            int boxEnd = Math.min(n, ((h[0] & 0xff) << 24) | ((h[1] & 0xff) << 16) | ((h[2] & 0xff) << 8) | (h[3] & 0xff));
            String brands = new String(h, 8, Math.max(4, boxEnd - 8), StandardCharsets.US_ASCII);
            if (brands.contains("avif") || brands.contains("avis")) return "avif";
            if (new String(h, 8, 4, StandardCharsets.US_ASCII).matches("hei[cmsx]|hev[cmsx]|mif1|msf1")) return "heic";
        }
        return null;
    }

    private static InputStream open(ContentResolver resolver, Uri uri) throws IOException {
        InputStream in = resolver.openInputStream(uri);
        if (in == null) throw new IOException("cannot open " + uri);
        return in;
    }

    private static MessageDigest sha256() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder hex = new StringBuilder();
        for (byte b : bytes) hex.append(String.format(Locale.ROOT, "%02x", b));
        return hex.toString();
    }

    private static boolean turned(int orientation) {
        return orientation == ExifInterface.ORIENTATION_ROTATE_90 || orientation == ExifInterface.ORIENTATION_ROTATE_270
            || orientation == ExifInterface.ORIENTATION_TRANSPOSE || orientation == ExifInterface.ORIENTATION_TRANSVERSE;
    }

    /** EXIF "2026:11:10 14:02:12" (+ "+08:00") → "2026-11-10T14:02:12+08:00"; the device time zone when no offset is given. */
    static String takenFromExif(String dateTime, String offset) {
        if (dateTime == null || !dateTime.matches("\\d{4}:\\d{2}:\\d{2} \\d{2}:\\d{2}:\\d{2}")) return null;
        String local = dateTime.substring(0, 10).replace(':', '-') + "T" + dateTime.substring(11);
        if (offset != null && offset.matches("[+-]\\d{2}:\\d{2}")) return local + offset;
        try {
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);
            format.setTimeZone(TimeZone.getDefault());
            return iso(format.parse(local).getTime());
        } catch (ParseException e) {
            return null;
        }
    }

    static String iso(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.ROOT);
        format.setTimeZone(TimeZone.getDefault());
        // XXX writes "Z" for UTC; EXIF and the photo line use "+00:00".
        return format.format(new Date(millis)).replaceFirst("Z$", "+00:00");
    }

    /**
     * For photos whose EXIF has no capture time (screenshots, saved images): the gallery's date taken, or else the
     * document's last-modified time (what the document picker offers).
     */
    private static String providerDate(ContentResolver resolver, Uri uri) {
        if (!"content".equals(uri.getScheme())) return null;
        for (String column : new String[] { MediaStore.Images.ImageColumns.DATE_TAKEN, DocumentsContract.Document.COLUMN_LAST_MODIFIED }) {
            try (Cursor cursor = resolver.query(uri, new String[] { column }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0) && cursor.getLong(0) > 0) return iso(cursor.getLong(0));
            } catch (RuntimeException ignored) {
                // Providers differ in the columns they offer.
            }
        }
        return null;
    }

    /**
     * Everything useful EXIF says about how and where the photo was taken, as photo line fields. Location is in the file
     * only when the app that handed it over kept it (Android removes it from gallery files for apps without location access).
     */
    static void readMeta(ExifInterface exif, Map<String, String> meta) {
        put(meta, "make", exif.getAttribute(ExifInterface.TAG_MAKE));
        put(meta, "model", exif.getAttribute(ExifInterface.TAG_MODEL));
        put(meta, "lensmake", exif.getAttribute("LensMake"));
        put(meta, "lens", exif.getAttribute("LensModel"));
        put(meta, "focal", number(exif.getAttributeDouble(ExifInterface.TAG_FOCAL_LENGTH, -1)));
        put(meta, "focal35", positive(exif.getAttributeInt("FocalLengthIn35mmFilm", -1)));
        put(meta, "f", number(exif.getAttributeDouble(ExifInterface.TAG_F_NUMBER, -1)));
        double exposure = exif.getAttributeDouble(ExifInterface.TAG_EXPOSURE_TIME, -1);
        // 1/n for short exposures; long ones (0.6 s, 2 s) as seconds.
        if (exposure > 0) put(meta, "exposure", exposure <= 0.5 ? "1/" + Math.round(1 / exposure) : number(exposure));
        int iso = exif.getAttributeInt("PhotographicSensitivity", -1);
        put(meta, "iso", positive(iso > 0 ? iso : exif.getAttributeInt("ISOSpeedRatings", -1)));
        if (exif.getAttribute("ExposureBiasValue") != null) put(meta, "ev", signed(exif.getAttributeDouble("ExposureBiasValue", 0)));
        int flash = exif.getAttributeInt(ExifInterface.TAG_FLASH, -1);
        if (flash >= 0) meta.put("flash", (flash & 1) == 1 ? "1" : "0");
        int wb = exif.getAttributeInt(ExifInterface.TAG_WHITE_BALANCE, -1);
        if (wb >= 0) meta.put("wb", wb == 0 ? "auto" : "manual");
        put(meta, "program", nonNegative(exif.getAttributeInt("ExposureProgram", -1)));
        put(meta, "metering", nonNegative(exif.getAttributeInt("MeteringMode", -1)));
        double zoom = exif.getAttributeDouble("DigitalZoomRatio", 0);
        if (zoom > 1) put(meta, "zoom", number(zoom));
        put(meta, "scene", nonNegative(exif.getAttributeInt("SceneCaptureType", -1)));
        float[] latLong = new float[2];
        @SuppressWarnings("deprecation") boolean located = exif.getLatLong(latLong);
        if (located && !(latLong[0] == 0 && latLong[1] == 0)) {
            meta.put("gps", String.format(Locale.ROOT, "%.6f,%.6f", latLong[0], latLong[1]));
            double alt = exif.getAltitude(Double.NaN);
            if (!Double.isNaN(alt)) put(meta, "alt", String.format(Locale.ROOT, "%.1f", alt));
            put(meta, "dir", number(exif.getAttributeDouble("GPSImgDirection", -1)));
            double speed = exif.getAttributeDouble("GPSSpeed", -1);
            String unit = exif.getAttribute("GPSSpeedRef"); // K km/h, M mph, N knots
            if (speed >= 0 && unit != null) put(meta, "speed", number(speed) + unit);
        }
        put(meta, "software", exif.getAttribute(ExifInterface.TAG_SOFTWARE));
    }

    private static void put(Map<String, String> meta, String name, String value) {
        if (value != null && !value.trim().isEmpty()) meta.put(name, value.trim().replaceAll("\\s+", " "));
    }

    /** A non-negative number with up to two decimals; null for the "missing" markers (negative, NaN). */
    private static String number(double value) {
        return value < 0 || Double.isNaN(value) ? null : signed(value);
    }

    private static String signed(double value) {
        if (Double.isNaN(value)) return null;
        String text = String.format(Locale.ROOT, "%.2f", value).replaceAll("\\.?0+$", "");
        return "-0".equals(text) ? "0" : text;
    }

    private static String positive(int value) {
        return value > 0 ? Integer.toString(value) : null;
    }

    private static String nonNegative(int value) {
        return value >= 0 ? Integer.toString(value) : null;
    }

    /**
     * The file to display: the original itself when the WebView can show it as is (JPEG, PNG, WebP, GIF, AVIF) and it is
     * small enough, else a preview made here (long side 1600 px, WebP) in previewDir, a cache that can be rebuilt any time.
     */
    static File preview(File original, File previewDir) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(original.getPath(), bounds);
        boolean showable = !original.getName().endsWith(".heic");
        if (showable && bounds.outWidth > 0 && Math.max(bounds.outWidth, bounds.outHeight) <= PREVIEW_SIDE) return original;
        File preview = previewFile(original, previewDir);
        if (preview.exists()) return preview;
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            if (showable) return original; // cannot decode it here; the WebView may still show it
            throw new IOException("cannot decode " + original.getName());
        }
        if (!previewDir.isDirectory() && !previewDir.mkdirs()) throw new IOException("cannot create " + previewDir);

        int orientation = ExifInterface.ORIENTATION_NORMAL;
        try {
            orientation = new ExifInterface(original.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        } catch (IOException | RuntimeException ignored) {
            // Shown as stored.
        }
        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (longest / (options.inSampleSize * 2) >= PREVIEW_SIDE) options.inSampleSize *= 2;
        Bitmap bitmap = BitmapFactory.decodeFile(original.getPath(), options);
        if (bitmap == null) throw new IOException("cannot decode " + original.getName());

        float scale = Math.min(1f, (float) PREVIEW_SIDE / Math.max(bitmap.getWidth(), bitmap.getHeight()));
        Matrix matrix = new Matrix();
        matrix.postScale(scale, scale);
        switch (orientation) {
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.postScale(-1, 1); break;
            case ExifInterface.ORIENTATION_ROTATE_180: matrix.postRotate(180); break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.postScale(1, -1); break;
            case ExifInterface.ORIENTATION_TRANSPOSE: matrix.postRotate(90); matrix.postScale(-1, 1); break;
            case ExifInterface.ORIENTATION_ROTATE_90: matrix.postRotate(90); break;
            case ExifInterface.ORIENTATION_TRANSVERSE: matrix.postRotate(270); matrix.postScale(-1, 1); break;
            case ExifInterface.ORIENTATION_ROTATE_270: matrix.postRotate(270); break;
            default: break;
        }
        Bitmap scaled = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        if (scaled != bitmap) bitmap.recycle();
        File partial = new File(preview.getPath() + ".part");
        try (OutputStream stream = new FileOutputStream(partial)) {
            if (!scaled.compress(webp(), PREVIEW_QUALITY, stream)) throw new IOException("cannot encode " + original.getName());
        } finally {
            scaled.recycle();
        }
        if (!partial.renameTo(preview)) throw new IOException("cannot write " + preview);
        return preview;
    }

    /** Named by the whole file name, so a 0.4.x copy and the original of the same photo do not share one. */
    static File previewFile(File original, File previewDir) {
        return new File(previewDir, original.getName() + ".webp");
    }

    @SuppressWarnings("deprecation")
    private static Bitmap.CompressFormat webp() {
        return Build.VERSION.SDK_INT >= 30 ? Bitmap.CompressFormat.WEBP_LOSSY : Bitmap.CompressFormat.WEBP;
    }
}
