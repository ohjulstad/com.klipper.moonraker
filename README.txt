Add support for 3D Printers that run klipper and moonraker

The app has been tested on a single Klipper 3D printer with moonraker.
Setups with multiple printers on one instance of Klipper is untested and probably unsupported.

Currently no support for API-keys and other than default ports for moonraker websocket (7125)

The app supports the following.
-- Pause and resume the print
-- Cancel print
-- Send custom GCode
-- trigger flows on different events
    -- print started
    -- print completed
    -- print paused
    -- print resumed
    -- print cancelled
    -- printer offline
    -- printer online

All Gcodes sendt to the printer must be tested and verified in a controlled manner,
I do not take any responsibility for any damage caused by this app not working properly, or GCodes that is sendt to the printer from this app.
Remember the 3D printer must be monitored at all times!

Have taken some inspiration from the Octoprint App :)

Happy printing!