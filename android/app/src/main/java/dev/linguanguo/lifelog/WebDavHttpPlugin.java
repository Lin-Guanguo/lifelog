package dev.linguanguo.lifelog;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;

/** Native HTTP for WebDAV sync: avoids WebView CORS and supports WebDAV methods. Bodies are base64. */
@CapacitorPlugin(name = "WebDavHttp")
public class WebDavHttpPlugin extends Plugin {

    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build();

    @PluginMethod
    public void request(PluginCall call) {
        String method = call.getString("method");
        String url = call.getString("url");
        if (method == null || url == null) {
            call.reject("method and url are required");
            return;
        }
        Map<String, String> headers = new HashMap<>();
        JSObject jsHeaders = call.getObject("headers", new JSObject());
        for (Iterator<String> keys = jsHeaders.keys(); keys.hasNext(); ) {
            String key = keys.next();
            headers.put(key, jsHeaders.getString(key));
        }
        String body = call.getString("body");
        byte[] bytes = body != null ? Base64.decode(body, Base64.NO_WRAP) : null;

        getBridge().execute(() -> {
            try {
                WebDavHttp.Result result = WebDavHttp.execute(client, method, url, headers, bytes);
                JSObject resultHeaders = new JSObject();
                for (Map.Entry<String, String> header : result.headers.entrySet()) {
                    resultHeaders.put(header.getKey(), header.getValue());
                }
                JSObject ret = new JSObject();
                ret.put("status", result.status);
                ret.put("headers", resultHeaders);
                ret.put("body", Base64.encodeToString(result.body, Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }
}
