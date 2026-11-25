package app.universalmediahub.plugins;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.CastState;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;

@CapacitorPlugin(name = "Cast")
public class CastPlugin extends Plugin {

    private CastContext castContext;

    @Override
    public void load() {
        try {
            castContext = CastContext.getSharedInstance(getContext());
        } catch (Exception e) {
            castContext = null;
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject res = new JSObject();
        res.put("available", castContext != null);
        res.put("state", castContext != null ? castContext.getCastState() : 0);
        call.resolve(res);
    }

    @PluginMethod
    public void state(PluginCall call) {
        JSObject res = new JSObject();
        int state = castContext != null ? castContext.getCastState() : 0;
        res.put("state", state);
        res.put("connected", state == CastState.CONNECTED);
        call.resolve(res);
    }

    @PluginMethod
    public void cast(PluginCall call) {
        String url = call.getString("url");
        String contentType = call.getString("contentType", "video/mp4");
        String title = call.getString("title", "MediaHub");
        if (url == null || url.isEmpty()) {
            call.reject("url requis");
            return;
        }
        if (castContext == null) {
            call.reject("Cast non initialisé");
            return;
        }
        if (castContext.getCastState() != CastState.CONNECTED) {
            call.reject("Aucun Chromecast connecté — connecte-toi d'abord via le menu Cast du système Android");
            return;
        }
        CastSession session = castContext.getSessionManager().getCurrentCastSession();
        if (session == null) {
            call.reject("Pas de session Cast");
            return;
        }
        RemoteMediaClient client = session.getRemoteMediaClient();
        if (client == null) {
            call.reject("RemoteMediaClient indisponible");
            return;
        }
        MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
        metadata.putString(MediaMetadata.KEY_TITLE, title);
        MediaInfo mediaInfo = new MediaInfo.Builder(url)
                .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
                .setContentType(contentType)
                .setMetadata(metadata)
                .build();
        client.load(mediaInfo).setResultCallback(result -> {
            if (result.getStatus().isSuccess()) {
                JSObject res = new JSObject();
                res.put("ok", true);
                call.resolve(res);
            } else {
                call.reject("Cast: " + result.getStatus().getStatusMessage());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (castContext != null) {
            CastSession session = castContext.getSessionManager().getCurrentCastSession();
            if (session != null && session.getRemoteMediaClient() != null) {
                session.getRemoteMediaClient().stop();
            }
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }
}
