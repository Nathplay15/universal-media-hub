package app.universalmediahub.plugins;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.apache.commons.net.ftp.FTPClient;
import org.apache.commons.net.ftp.FTPFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.Security;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import fi.iki.elonen.NanoHTTPD;

import com.hierynomus.smbj.SMBClient;
import com.hierynomus.smbj.auth.AuthenticationContext;
import com.hierynomus.smbj.connection.Connection;
import com.hierynomus.smbj.session.Session;
import com.hierynomus.smbj.share.DiskShare;
import com.hierynomus.smbj.share.Directory;
import com.hierynomus.smbj.share.DiskEntry;
import com.hierynomus.smbj.share.File;
import com.hierynomus.msdtyp.AccessMask;
import com.hierynomus.mssmb2.SMB2CreateOptions;
import com.hierynomus.mssmb2.SMB2CreateDisposition;
import com.hierynomus.msfscc.fileinformation.FileStandardInformation;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import net.schmizz.sshj.SSHClient;
import net.schmizz.sshj.sftp.RemoteFile;
import net.schmizz.sshj.sftp.RemoteResourceInfo;
import net.schmizz.sshj.sftp.SFTPClient;
import net.schmizz.sshj.transport.verification.PromiscuousVerifier;

import org.bouncycastle.jce.provider.BouncyCastleProvider;

@CapacitorPlugin(name = "LanFiles")
public class LanFilesPlugin extends Plugin {

    interface RemoteResource {
        long size() throws Exception;
        InputStream open(long offset) throws Exception;
        String mime();
        void close();
    }

    final Map<String, RemoteResource> sessions = new ConcurrentHashMap<>();
    private ProxyServer server;

    @Override
    public void load() {
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(new BouncyCastleProvider());
        }
    }

    private void ensureServer() throws IOException {
        if (server == null || !server.isAlive()) {
            server = new ProxyServer();
            server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
        }
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".mkv")) return "video/x-matroska";
        if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".avi")) return "video/x-msvideo";
        if (n.endsWith(".mov")) return "video/quicktime";
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".flac")) return "audio/flac";
        if (n.endsWith(".m4a")) return "audio/mp4";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".srt")) return "application/x-subrip";
        if (n.endsWith(".vtt")) return "text/vtt";
        return "application/octet-stream";
    }

    private static String basicAuth(String user, String pass) {
        return android.util.Base64.encodeToString((user + ":" + pass).getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
    }

    private RemoteResource createResource(PluginCall call) throws Exception {
        String type = call.getString("type", "http");
        switch (type) {
            case "smb": return new SmbResource(call);
            case "ftp": return new FtpResource(call);
            case "sftp": return new SftpResource(call);
            default: return new HttpResource(call);
        }
    }

    @PluginMethod
    public void ping(PluginCall call) {
        new Thread(() -> {
            try {
                RemoteResource r = createResource(call);
                long size = r.size();
                r.close();
                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("size", size);
                call.resolve(res);
            } catch (Exception e) {
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("error", e.getMessage());
                call.resolve(res);
            }
        }).start();
    }

    @PluginMethod
    public void browse(PluginCall call) {
        new Thread(() -> {
            try {
                String type = call.getString("type", "http");
                String path = call.getString("path", "");
                JSArray arr = new JSArray();
                if ("smb".equals(type)) {
                    SMBClient client = new SMBClient();
                    Connection conn = client.connect(call.getString("host"), call.getInt("port", 445));
                    Session session = conn.authenticate(new AuthenticationContext(call.getString("user", ""), call.getString("pass", "").toCharArray(), call.getString("domain", "")));
                    DiskShare share = (DiskShare) session.connectShare(call.getString("share", ""));
                    try {
                        Set<AccessMask> access = EnumSet.of(AccessMask.GENERIC_READ);
                        Set<SMB2CreateOptions> dirOpts = EnumSet.of(SMB2CreateOptions.FILE_DIRECTORY_FILE);
                        Directory dir = share.openDirectory(
                                path,
                                access,
                                null,
                                dirOpts,
                                SMB2CreateDisposition.FILE_OPEN,
                                null);
                        List<?> entries = dir.list();
                        for (Object o : entries) {
                            DiskEntry e = (DiskEntry) o;
                            FileStandardInformation info = e.getFileInformation(FileStandardInformation.class);
                            boolean isDir = info.isDirectory();
                            long size = isDir ? 0 : info.getEndOfFile();
                            String name = e.getFileName();
                            JSObject jo = new JSObject();
                            jo.put("name", name);
                            jo.put("path", path + (path.endsWith("/") || path.isEmpty() ? "" : "/") + name);
                            jo.put("isDir", isDir);
                            jo.put("size", size);
                            arr.put(jo);
                        }
                        dir.close();
                    } finally {
                        share.close();
                        session.close();
                        conn.close();
                        client.close();
                    }
                } else if ("ftp".equals(type)) {
                    FTPClient ftp = new FTPClient();
                    ftp.connect(call.getString("host"), call.getInt("port", 21));
                    ftp.login(call.getString("user", ""), call.getString("pass", ""));
                    ftp.setFileType(FTPClient.BINARY_FILE_TYPE);
                    for (FTPFile f : ftp.listFiles(path)) {
                        JSObject o = new JSObject();
                        o.put("name", f.getName());
                        o.put("path", path + (path.endsWith("/") || path.isEmpty() ? "" : "/") + f.getName());
                        o.put("isDir", f.isDirectory());
                        o.put("size", f.getSize());
                        arr.put(o);
                    }
                    ftp.logout();
                    ftp.disconnect();
                } else if ("sftp".equals(type)) {
                    SSHClient ssh = new SSHClient();
                    ssh.addHostKeyVerifier(new PromiscuousVerifier());
                    ssh.connect(call.getString("host"), call.getInt("port", 22));
                    ssh.authPassword(call.getString("user", ""), call.getString("pass", ""));
                    SFTPClient sftp = ssh.newSFTPClient();
                    for (RemoteResourceInfo e : sftp.ls(path)) {
                        JSObject o = new JSObject();
                        o.put("name", e.getName());
                        o.put("path", path + (path.endsWith("/") || path.isEmpty() ? "" : "/") + e.getName());
                        o.put("isDir", e.isDirectory());
                        o.put("size", e.getAttributes().getSize());
                        arr.put(o);
                    }
                    sftp.close();
                    ssh.disconnect();
                } else {
                    call.reject("browse: utiliser propfind pour le type http/webdav");
                    return;
                }
                JSObject res = new JSObject();
                res.put("items", arr);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("browse: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void propfind(PluginCall call) {
        new Thread(() -> {
            try {
                String url = call.getString("url");
                String auth = call.getString("auth");
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("PROPFIND");
                conn.setRequestProperty("Depth", String.valueOf(call.getInt("depth", 1)));
                conn.setRequestProperty("Content-Type", "application/xml; charset=utf-8");
                if (auth != null && !auth.isEmpty()) conn.setRequestProperty("Authorization", "Basic " + auth);
                conn.setDoOutput(true);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write("<?xml version=\"1.0\"?><D:propfind xmlns:D=\"DAV:\"><D:prop><D:displayname/><D:resourcetype/><D:getcontentlength/><D:getcontenttype/></D:prop></D:propfind>".getBytes(StandardCharsets.UTF_8));
                }
                int code = conn.getResponseCode();
                InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String xml = readAll(in);
                JSObject res = new JSObject();
                res.put("status", code);
                res.put("xml", xml);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("propfind: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void openStream(PluginCall call) {
        new Thread(() -> {
            try {
                RemoteResource r = createResource(call);
                r.size();
                String id = UUID.randomUUID().toString();
                sessions.put(id, r);
                ensureServer();
                JSObject res = new JSObject();
                res.put("id", id);
                res.put("url", "http://127.0.0.1:" + server.getListeningPort() + "/s/" + id);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("openStream: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void closeStream(PluginCall call) {
        String id = call.getString("id");
        RemoteResource r = sessions.remove(id);
        if (r != null) {
            try { r.close(); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
        in.close();
        return bos.toString(StandardCharsets.UTF_8);
    }

    class ProxyServer extends NanoHTTPD {
        ProxyServer() {
            super("127.0.0.1", 0);
        }

        @Override
        public Response serve(IHTTPSession session) {
            String uri = session.getUri();
            if (uri.startsWith("/s/")) {
                RemoteResource res = sessions.get(uri.substring(3));
                if (res == null) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "session inconnue");
                try {
                    long size = res.size();
                    String range = session.getHeaders().get("range");
                    long start = 0;
                    long end = size - 1;
                    Response.Status st = Response.Status.OK;
                    if (range != null && range.startsWith("bytes=")) {
                        String[] parts = range.substring(6).split("-", -1);
                        if (!parts[0].isEmpty()) start = Long.parseLong(parts[0]);
                        if (parts.length > 1 && !parts[1].isEmpty()) end = Math.min(Long.parseLong(parts[1]), size - 1);
                        if (start >= size) {
                            Response r = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", "");
                            r.addHeader("Content-Range", "bytes */" + size);
                            return r;
                        }
                        st = Response.Status.PARTIAL_CONTENT;
                    }
                    if (end < start) end = size - 1;
                    InputStream in = res.open(start);
                    Response resp = newFixedLengthResponse(st, res.mime(), in, end - start + 1);
                    resp.addHeader("Accept-Ranges", "bytes");
                    resp.addHeader("Access-Control-Allow-Origin", "*");
                    if (st == Response.Status.PARTIAL_CONTENT) {
                        resp.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
                    }
                    return resp;
                } catch (Exception e) {
                    return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "erreur: " + e.getMessage());
                }
            }
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found");
        }
    }

    static class SmbResource implements RemoteResource {
        private final SMBClient client = new SMBClient();
        private final Connection conn;
        private final Session session;
        private final DiskShare share;
        private final File file;

        SmbResource(PluginCall call) throws Exception {
            conn = client.connect(call.getString("host"), call.getInt("port", 445));
            session = conn.authenticate(new AuthenticationContext(call.getString("user", ""), call.getString("pass", "").toCharArray(), call.getString("domain", "")));
            share = (DiskShare) session.connectShare(call.getString("share", ""));
            Set<AccessMask> access = EnumSet.of(AccessMask.GENERIC_READ);
            Set<SMB2CreateOptions> fileOpts = EnumSet.of(SMB2CreateOptions.FILE_NON_DIRECTORY_FILE);
            file = share.openFile(
                    call.getString("path", ""),
                    access,
                    null,
                    fileOpts,
                    SMB2CreateDisposition.FILE_OPEN,
                    null);
        }

        public long size() { return file.getFileInformation(FileStandardInformation.class).getEndOfFile(); }
        public String mime() { return mimeOf(file.getFileName()); }

        public InputStream open(long offset) throws Exception {
            InputStream in = file.getInputStream();
            long skipped = 0;
            while (skipped < offset) {
                long s = in.skip(offset - skipped);
                if (s <= 0) {
                    if (in.read() == -1) break;
                    s = 1;
                }
                skipped += s;
            }
            return in;
        }

        public void close() {
            try { file.close(); } catch (Exception ignored) {}
            try { share.close(); } catch (Exception ignored) {}
            try { session.close(); } catch (Exception ignored) {}
            try { conn.close(); } catch (Exception ignored) {}
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    static class FtpResource implements RemoteResource {
        private final String host; private final int port;
        private final String user; private final String pass; private final String path;

        FtpResource(PluginCall call) {
            this.host = call.getString("host");
            this.port = call.getInt("port", 21);
            this.user = call.getString("user", "");
            this.pass = call.getString("pass", "");
            this.path = call.getString("path", "/");
        }

        private FTPClient connect() throws IOException {
            FTPClient ftp = new FTPClient();
            ftp.connect(host, port);
            ftp.login(user, pass);
            ftp.setFileType(FTPClient.BINARY_FILE_TYPE);
            ftp.enterLocalPassiveMode();
            return ftp;
        }

        public long size() throws IOException {
            FTPClient ftp = connect();
            try {
                FTPFile f = ftp.mlistFile(path);
                return f != null ? f.getSize() : 0;
            } finally {
                try { ftp.logout(); ftp.disconnect(); } catch (Exception ignored) {}
            }
        }

        public String mime() { return mimeOf(path); }

        public InputStream open(long offset) throws IOException {
            FTPClient ftp = connect();
            if (offset > 0) ftp.setRestartOffset(offset);
            InputStream in = ftp.retrieveFileStream(path);
            if (in == null) throw new IOException("retrieveFileStream null (code " + ftp.getReplyCode() + ")");
            final FTPClient f = ftp;
            return new InputStream() {
                @Override public int read() throws IOException { return in.read(); }
                @Override public int read(byte[] b, int off, int len) throws IOException { return in.read(b, off, len); }
                @Override public void close() throws IOException {
                    try { in.close(); } finally {
                        try { f.completePendingCommand(); } catch (Exception ignored) {}
                        try { f.logout(); f.disconnect(); } catch (Exception ignored) {}
                    }
                }
            };
        }

        public void close() {}
    }

    static class SftpResource implements RemoteResource {
        private final SSHClient ssh;
        private final SFTPClient sftp;
        private final String path;

        SftpResource(PluginCall call) throws IOException {
            ssh = new SSHClient();
            ssh.addHostKeyVerifier(new PromiscuousVerifier());
            ssh.connect(call.getString("host"), call.getInt("port", 22));
            ssh.authPassword(call.getString("user", ""), call.getString("pass", ""));
            sftp = ssh.newSFTPClient();
            path = call.getString("path", "/");
        }

        public long size() throws IOException {
            return sftp.stat(path).getSize();
        }

        public String mime() { return mimeOf(path); }

        public InputStream open(long offset) throws IOException {
            final RemoteFile rf = sftp.open(path);
            return new InputStream() {
                private long pos = offset;
                private final byte[] buf = new byte[65536];
                private int bufLen = 0;
                private int bufPos = 0;

                @Override
                public int read() throws IOException {
                    byte[] one = new byte[1];
                    int n = read(one, 0, 1);
                    return n == -1 ? -1 : one[0] & 0xFF;
                }

                @Override
                public int read(byte[] b, int off, int len) throws IOException {
                    if (bufPos >= bufLen) {
                        int n = rf.read(pos, buf, 0, buf.length);
                        if (n <= 0) return -1;
                        pos += n;
                        bufLen = n;
                        bufPos = 0;
                    }
                    int n = Math.min(len, bufLen - bufPos);
                    System.arraycopy(buf, bufPos, b, off, n);
                    bufPos += n;
                    return n;
                }

                @Override
                public void close() throws IOException {
                    rf.close();
                }
            };
        }

        public void close() {
            try { sftp.close(); } catch (Exception ignored) {}
            try { ssh.disconnect(); } catch (Exception ignored) {}
        }
    }

    static class HttpResource implements RemoteResource {
        private final String url;
        private final String auth;

        HttpResource(PluginCall call) {
            this.url = call.getString("url");
            String user = call.getString("user", "");
            String pass = call.getString("pass", "");
            this.auth = (user.isEmpty() && pass.isEmpty()) ? null : basicAuth(user, pass);
        }

        private HttpURLConnection openConn(Long rangeStart) throws IOException {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            if (auth != null) conn.setRequestProperty("Authorization", "Basic " + auth);
            if (rangeStart != null) conn.setRequestProperty("Range", "bytes=" + rangeStart + "-");
            conn.connect();
            return conn;
        }

        public long size() throws IOException {
            HttpURLConnection conn = openConn(null);
            try {
                long len = conn.getContentLengthLong();
                if (len <= 0) {
                    String cr = conn.getHeaderField("Content-Range");
                    if (cr != null && cr.contains("/")) len = Long.parseLong(cr.substring(cr.indexOf('/') + 1).trim());
                }
                return len;
            } finally {
                conn.disconnect();
            }
        }

        public String mime() {
            try {
                HttpURLConnection conn = openConn(null);
                String ct = conn.getContentType();
                conn.disconnect();
                if (ct != null && !ct.isEmpty()) return ct;
            } catch (Exception ignored) {}
            return mimeOf(url);
        }

        public InputStream open(long offset) throws IOException {
            HttpURLConnection conn = openConn(offset);
            int code = conn.getResponseCode();
            if (code >= 400) throw new IOException("HTTP " + code + " pour " + url);
            return conn.getInputStream();
        }

        public void close() {}
    }
}
