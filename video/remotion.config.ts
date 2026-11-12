// Réglages du CLI Remotion (studio et rendu).
// Le navigateur : celui que Remotion installe lui-même (Chrome Headless Shell),
// sauf si REMOTION_NAVIGATEUR désigne un Chromium déjà présent sur la machine.
import { Config } from "@remotion/cli/config";

Config.setEntryPoint("./src/index.ts");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
if (process.env.REMOTION_NAVIGATEUR) Config.setBrowserExecutable(process.env.REMOTION_NAVIGATEUR);
