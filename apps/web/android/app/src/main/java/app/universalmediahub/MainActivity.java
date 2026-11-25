package app.universalmediahub;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import app.universalmediahub.plugins.CastPlugin;
import app.universalmediahub.plugins.DlnaPlugin;
import app.universalmediahub.plugins.LanFilesPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LanFilesPlugin.class);
        registerPlugin(DlnaPlugin.class);
        registerPlugin(CastPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
