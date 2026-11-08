package dev.linguanguo.lifelog;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okio.Buffer;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class WebDavHttpTest {

    private MockWebServer server;
    private final OkHttpClient client = new OkHttpClient();

    @Before
    public void start() throws Exception {
        server = new MockWebServer();
        server.start();
    }

    @After
    public void stop() throws Exception {
        server.shutdown();
    }

    @Test
    public void sendsPropfindWithHeadersAndBody() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(207).addHeader("ETag", "\"v1\"").setBody("<multistatus/>"));
        Map<String, String> headers = new HashMap<>();
        headers.put("Depth", "0");
        headers.put("Content-Type", "application/xml");

        WebDavHttp.Result result = WebDavHttp.execute(client, "PROPFIND", server.url("/dav/").toString(), headers,
            "<propfind/>".getBytes(StandardCharsets.UTF_8));

        RecordedRequest request = server.takeRequest();
        assertEquals("PROPFIND", request.getMethod());
        assertEquals("0", request.getHeader("Depth"));
        assertEquals("<propfind/>", request.getBody().readUtf8());
        assertEquals(207, result.status);
        assertEquals("\"v1\"", result.headers.get("etag"));
        assertEquals("<multistatus/>", new String(result.body, StandardCharsets.UTF_8));
    }

    @Test
    public void sendsBodilessWebDavMethods() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(201));
        server.enqueue(new MockResponse().setResponseCode(204));
        Map<String, String> move = new HashMap<>();
        move.put("Destination", server.url("/dav/b").toString());
        move.put("Overwrite", "T");

        assertEquals(201, WebDavHttp.execute(client, "MKCOL", server.url("/dav/dir/").toString(), new HashMap<>(), null).status);
        assertEquals(204, WebDavHttp.execute(client, "MOVE", server.url("/dav/a").toString(), move, null).status);

        assertEquals("MKCOL", server.takeRequest().getMethod());
        RecordedRequest moveRequest = server.takeRequest();
        assertEquals("MOVE", moveRequest.getMethod());
        assertEquals("T", moveRequest.getHeader("Overwrite"));
    }

    @Test
    public void roundTripsBinaryBodies() throws Exception {
        byte[] binary = new byte[] { 0, 1, 2, (byte) 0xff, (byte) 0x80, 'S', 'Q', 'L' };
        server.enqueue(new MockResponse().setResponseCode(201));
        server.enqueue(new MockResponse().setBody(new Buffer().write(binary)));
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "application/vnd.sqlite3");

        WebDavHttp.execute(client, "PUT", server.url("/dav/f").toString(), headers, binary);
        WebDavHttp.Result get = WebDavHttp.execute(client, "GET", server.url("/dav/f").toString(), new HashMap<>(), null);

        assertArrayEquals(binary, server.takeRequest().getBody().readByteArray());
        assertArrayEquals(binary, get.body);
    }
}
