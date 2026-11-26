package app.universalmediahub.plugins;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import javax.xml.parsers.DocumentBuilderFactory;

@CapacitorPlugin(name = "Dlna")
public class DlnaPlugin extends Plugin {

    private final Map<String, String[]> devices = new ConcurrentHashMap<>();

    @PluginMethod
    public void discover(PluginCall call) {
        new Thread(() -> {
            try {
                JSArray arr = new JSArray();
                DatagramSocket socket = new DatagramSocket();
                socket.setSoTimeout(1500);
                String req = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 3\r\nST: urn:schemas-upnp-org:device:MediaServer:1\r\n\r\n";
                byte[] data = req.getBytes(StandardCharsets.UTF_8);
                socket.send(new DatagramPacket(data, data.length, InetAddress.getByName("239.255.255.250"), 1900));
                socket.send(new DatagramPacket(data, data.length, InetAddress.getByName("239.255.255.250"), 1900));
                Set<String> locations = new HashSet<>();
                long deadline = System.currentTimeMillis() + 6000;
                while (System.currentTimeMillis() < deadline) {
                    try {
                        byte[] buf = new byte[4096];
                        DatagramPacket resp = new DatagramPacket(buf, buf.length);
                        socket.receive(resp);
                        String s = new String(buf, 0, resp.getLength(), StandardCharsets.UTF_8);
                        for (String line : s.split("\r\n")) {
                            if (line.toUpperCase().startsWith("LOCATION:")) {
                                locations.add(line.substring(9).trim());
                            }
                        }
                    } catch (SocketTimeoutException ignored) {}
                }
                socket.close();
                for (String loc : locations) {
                    try {
                        String xml = httpGet(loc, null);
                        String udn = extractTag(xml, "UDN");
                        String name = extractTag(xml, "friendlyName");
                        String control = extractContentDirectoryControl(xml, loc);
                        if (udn != null && control != null) {
                            devices.put(udn, new String[]{loc, name != null && !name.isEmpty() ? name : udn, control});
                            JSObject o = new JSObject();
                            o.put("id", udn);
                            o.put("name", name != null && !name.isEmpty() ? name : udn);
                            o.put("location", loc);
                            arr.put(o);
                        }
                    } catch (Exception ignored) {}
                }
                JSObject res = new JSObject();
                res.put("devices", arr);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("SSDP discover: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void browse(PluginCall call) {
        String udn = call.getString("deviceId");
        String objectId = call.getString("objectId", "0");
        String[] dev = devices.get(udn);
        if (dev == null) {
            call.reject("Périphérique DLNA inconnu — appeler discover() d'abord");
            return;
        }
        new Thread(() -> {
            try {
                String soap = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                        + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                        + "<s:Body><u:Browse xmlns:u=\"urn:schemas-upnp-org:service:ContentDirectory:1\">"
                        + "<ObjectID>" + escapeXml(objectId) + "</ObjectID>"
                        + "<BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter>"
                        + "<StartingIndex>0</StartingIndex><RequestedCount>2000</RequestedCount><SortCriteria></SortCriteria>"
                        + "</u:Browse></s:Body></s:Envelope>";
                HttpURLConnection conn = (HttpURLConnection) new URL(dev[2]).openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
                conn.setRequestProperty("SOAPACTION", "\"urn:schemas-upnp-org:service:ContentDirectory:1#Browse\"");
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(soap.getBytes(StandardCharsets.UTF_8));
                }
                String resp = readAll(conn.getInputStream());
                String didl = extractSoapResult(resp);
                JSArray items = parseDidl(didl, dev[0]);
                JSObject res = new JSObject();
                res.put("items", items);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Browse: " + e.getMessage());
            }
        }).start();
    }

    private static String httpGet(String urlStr, String auth) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        if (auth != null) conn.setRequestProperty("Authorization", "Basic " + auth);
        return readAll(conn.getInputStream());
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
        in.close();
        return bos.toString(StandardCharsets.UTF_8);
    }

    private static String extractTag(String xml, String tag) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("<" + tag + "[^>]*>(.*?)</" + tag + ">", java.util.regex.Pattern.DOTALL)
                .matcher(xml);
        return m.find() ? m.group(1).trim() : null;
    }

    private static String extractContentDirectoryControl(String xml, String location) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("<service>(.*?)</service>", java.util.regex.Pattern.DOTALL)
                .matcher(xml);
        while (m.find()) {
            String block = m.group(1);
            if (block.contains("urn:schemas-upnp-org:service:ContentDirectory:")) {
                String c = extractTag(block, "controlURL");
                if (c != null) return resolveUrl(location, c);
            }
        }
        return null;
    }

    private static String extractSoapResult(String soapResp) {
        String r = extractTag(soapResp, "Result");
        if (r == null) return "";
        return r.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&");
    }

    private static String resolveUrl(String base, String url) {
        if (url == null) return null;
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        try {
            URL b = new URL(base);
            if (url.startsWith("/")) return b.getProtocol() + "://" + b.getHost() + (b.getPort() > 0 ? ":" + b.getPort() : "") + url;
            String p = b.getPath();
            String dir = p.contains("/") ? p.substring(0, p.lastIndexOf('/') + 1) : "/";
            return b.getProtocol() + "://" + b.getHost() + (b.getPort() > 0 ? ":" + b.getPort() : "") + dir + url;
        } catch (Exception e) {
            return url;
        }
    }

    private static String escapeXml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static JSArray parseDidl(String didl, String baseLocation) throws Exception {
        JSArray arr = new JSArray();
        if (didl == null || didl.isEmpty()) return arr;
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        Document doc = f.newDocumentBuilder().parse(new java.io.ByteArrayInputStream(("<root xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">" + didl + "</root>").getBytes(StandardCharsets.UTF_8)));
        NodeList containers = doc.getElementsByTagName("container");
        NodeList items = doc.getElementsByTagName("item");
        for (int i = 0; i < containers.getLength(); i++) {
            Element el = (Element) containers.item(i);
            JSObject o = new JSObject();
            o.put("id", el.getAttribute("id"));
            o.put("title", childText(el, "dc:title"));
            o.put("isDir", true);
            arr.put(o);
        }
        for (int i = 0; i < items.getLength(); i++) {
            Element el = (Element) items.item(i);
            JSObject o = new JSObject();
            o.put("id", el.getAttribute("id"));
            o.put("title", childText(el, "dc:title"));
            o.put("isDir", false);
            NodeList resList = el.getElementsByTagName("res");
            for (int j = 0; j < resList.getLength(); j++) {
                Element res = (Element) resList.item(j);
                String proto = res.getAttribute("protocolInfo");
                String url = res.getTextContent().trim();
                if (url.isEmpty()) continue;
                o.put("url", resolveUrl(baseLocation, url));
                if (proto.contains(":")) {
                    String[] parts = proto.split(":");
                    if (parts.length >= 3) o.put("mime", parts[2]);
                }
                String size = res.getAttribute("size");
                if (!size.isEmpty()) o.put("size", Long.parseLong(size));
                break;
            }
            arr.put(o);
        }
        return arr;
    }

    private static String childText(Element el, String tag) {
        NodeList nl = el.getElementsByTagName(tag);
        return nl.getLength() > 0 ? nl.item(0).getTextContent().trim() : "";
    }
}
