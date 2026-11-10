package dev.linguanguo.lifelog;

import android.content.ContentResolver;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Turns an original photo into LifeLog's copy: media/<key>.webp, where key is the first 32 hex digits of the
 * SHA-256 of the original's bytes; long side at most 1600 px; EXIF (location included) not carried over.
 * Also reads what the photo line records about the original: capture time, size, file name and folder.
 */
final class PhotoImport {

    static final int LONG_SIDE = 1600;
    static final int QUALITY = 80;

    static final class Result {
        String file;
        String taken; // ISO 8601 with offset, or null
        int width;
        int height;
        String path; // folder/name of the original when known, or just its name
    }

    private PhotoImport() {}

    static Result run(ContentResolver resolver, Uri uri, File mediaDir) throws IOException {
        Result result = new Result();
        String key = hash(resolver, uri);
        result.file = key + ".webp";

        int orientation = ExifInterface.ORIENTATION_NORMAL;
        ExifInterface exif = readExif(resolver, uri);
        if (exif != null) {
            orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            result.taken = takenFromExif(exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL), exif.getAttribute("OffsetTimeOriginal"));
        }

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = open(resolver, uri)) {
            BitmapFactory.decodeStream(in, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("not an image: " + uri);
        boolean turned = orientation == ExifInterface.ORIENTATION_ROTATE_90 || orientation == ExifInterface.ORIENTATION_ROTATE_270
            || orientation == ExifInterface.ORIENTATION_TRANSPOSE || orientation == ExifInterface.ORIENTATION_TRANSVERSE;
        result.width = turned ? bounds.outHeight : bounds.outWidth;
        result.height = turned ? bounds.outWidth : bounds.outHeight;

        describe(resolver, uri, result);

        File out = new File(mediaDir, result.file);
        if (!out.exists()) writeCopy(resolver, uri, bounds, orientation, out);
        return result;
    }

    /** A seekable file descriptor where the provider gives one (needed for HEIF), else a stream; null if unreadable. */
    private static ExifInterface readExif(ContentResolver resolver, Uri uri) {
        try (ParcelFileDescriptor fd = resolver.openFileDescriptor(uri, "r")) {
            if (fd != null) return new ExifInterface(fd.getFileDescriptor());
        } catch (IOException | RuntimeException ignored) {
            // Fall back to a stream.
        }
        try (InputStream in = open(resolver, uri)) {
            return new ExifInterface(in);
        } catch (IOException | RuntimeException e) {
            return null; // Not every image has readable EXIF; the copy is still made.
        }
    }

    private static InputStream open(ContentResolver resolver, Uri uri) throws IOException {
        InputStream in = resolver.openInputStream(uri);
        if (in == null) throw new IOException("cannot open " + uri);
        return in;
    }

    static String hash(ContentResolver resolver, Uri uri) throws IOException {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
        byte[] buffer = new byte[64 * 1024];
        try (InputStream in = open(resolver, uri)) {
            for (int n; (n = in.read(buffer)) > 0; ) digest.update(buffer, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
        return hex.substring(0, 32);
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

    /** File name and folder from the provider; the capture time from the gallery when EXIF has none. */
    private static void describe(ContentResolver resolver, Uri uri, Result result) {
        String name = null;
        String folder = null;
        long dateTaken = 0;
        String[][] projections = {
            Build.VERSION.SDK_INT >= 29
                ? new String[] { OpenableColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.Images.ImageColumns.DATE_TAKEN }
                : new String[] { OpenableColumns.DISPLAY_NAME, MediaStore.Images.ImageColumns.DATE_TAKEN },
            new String[] { OpenableColumns.DISPLAY_NAME },
        };
        for (String[] projection : projections) {
            try (Cursor cursor = resolver.query(uri, projection, null, null, null)) {
                if (cursor == null || !cursor.moveToFirst()) continue;
                name = string(cursor, OpenableColumns.DISPLAY_NAME);
                if (Build.VERSION.SDK_INT >= 29) folder = string(cursor, MediaStore.MediaColumns.RELATIVE_PATH);
                int taken = cursor.getColumnIndex(MediaStore.Images.ImageColumns.DATE_TAKEN);
                if (taken >= 0 && !cursor.isNull(taken)) dateTaken = cursor.getLong(taken);
                break;
            } catch (RuntimeException ignored) {
                // Providers support different columns (the photo picker fewer than MediaStore); try fewer.
            }
        }
        if (name != null) result.path = folder != null ? folder.replaceAll("/+$", "") + "/" + name : name;
        if (result.taken == null && dateTaken > 0) result.taken = iso(dateTaken);
    }

    private static String string(Cursor cursor, String column) {
        int i = cursor.getColumnIndex(column);
        return i >= 0 && !cursor.isNull(i) ? cursor.getString(i) : null;
    }

    private static void writeCopy(ContentResolver resolver, Uri uri, BitmapFactory.Options bounds, int orientation, File out)
        throws IOException {
        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (longest / (options.inSampleSize * 2) >= LONG_SIDE) options.inSampleSize *= 2;
        Bitmap bitmap;
        try (InputStream in = open(resolver, uri)) {
            bitmap = BitmapFactory.decodeStream(in, null, options);
        }
        if (bitmap == null) throw new IOException("cannot decode " + uri);

        float scale = Math.min(1f, (float) LONG_SIDE / Math.max(bitmap.getWidth(), bitmap.getHeight()));
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
        Bitmap copy = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        if (copy != bitmap) bitmap.recycle();

        File partial = new File(out.getPath() + ".part");
        try (OutputStream stream = new FileOutputStream(partial)) {
            if (!copy.compress(webp(), QUALITY, stream)) throw new IOException("cannot encode " + uri);
        } finally {
            copy.recycle();
        }
        if (!partial.renameTo(out)) throw new IOException("cannot write " + out);
    }

    @SuppressWarnings("deprecation")
    private static Bitmap.CompressFormat webp() {
        return Build.VERSION.SDK_INT >= 30 ? Bitmap.CompressFormat.WEBP_LOSSY : Bitmap.CompressFormat.WEBP;
    }
}
