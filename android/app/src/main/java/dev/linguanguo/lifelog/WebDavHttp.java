package dev.linguanguo.lifelog;

import java.io.IOException;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.internal.http.HttpMethod;

/** Plain HTTP client that allows any method (PROPFIND, MKCOL, MOVE), unlike HttpURLConnection. */
final class WebDavHttp {

    static final class Result {
        final int status;
        final Map<String, String> headers;
        final byte[] body;

        Result(int status, Map<String, String> headers, byte[] body) {
            this.status = status;
            this.headers = headers;
            this.body = body;
        }
    }

    private WebDavHttp() {}

    static Result execute(OkHttpClient client, String method, String url, Map<String, String> headers, byte[] body)
        throws IOException {
        RequestBody requestBody = null;
        if (body != null || HttpMethod.requiresRequestBody(method)) {
            String type = headers.get("Content-Type");
            requestBody = RequestBody.create(body != null ? body : new byte[0], type != null ? MediaType.parse(type) : null);
        }
        Request.Builder builder = new Request.Builder().url(url).method(method, requestBody);
        for (Map.Entry<String, String> header : headers.entrySet()) {
            builder.header(header.getKey(), header.getValue());
        }
        try (Response response = client.newCall(builder.build()).execute()) {
            Map<String, String> out = new HashMap<>();
            for (String name : response.headers().names()) {
                out.put(name.toLowerCase(Locale.ROOT), String.join(", ", response.headers(name)));
            }
            ResponseBody responseBody = response.body();
            return new Result(response.code(), out, responseBody != null ? responseBody.bytes() : new byte[0]);
        }
    }
}
