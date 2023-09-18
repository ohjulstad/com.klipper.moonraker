import Homey from 'homey';
import { MoonrakerAPI } from '../../lib/moonraker';

class MoonrakerDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  private runGCodeAction = this.homey.flow.getActionCard("run-gcode");
  private pausePrinterAction = this.homey.flow.getActionCard("pause-print");

  async onInit() {

    this.runGCodeAction.registerRunListener(async (args) => {
      await args.device.runGcode(args.GCode);
    });

    this.pausePrinterAction.registerRunListener(async (args) => {
      await args.device.pausePrinter();
    })


    this.log('MyDriver has been initialized');
  }
  
  async onPair(session: import("homey/lib/PairSession")) {
    session.setHandler('showView', async (viewId) => {
      if('start_pair_klipper' === viewId) {
        
        session.setHandler('addMoonrakerPrinter', async (connection) => {
          const moonraker = new MoonrakerAPI(connection.address);
          return moonraker.getPrinterInfo().catch(error => this.log(error))
        });
      }
    });
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */

}

module.exports = MoonrakerDriver;
