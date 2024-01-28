import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
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


    this.log('Klipper 3D printer driver has been initialized');
  }

  async onPair(session: PairSession) {       
    this.log("start_pair_klipper");

    session.setHandler('add_Moonraker_Printer', async (connection)  => {
      this.log(connection);
      const moonraker = new MoonrakerAPI(connection.address, connection.port, false);
      return moonraker.getPrinterInfo().catch(error => this.log(error));  
    });
  }
}

module.exports = MoonrakerDriver;
