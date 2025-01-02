import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { MoonrakerAPI, PRINTER_STATUS } from '../../lib/moonraker';

class MoonrakerDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  private runGCodeAction = this.homey.flow.getActionCard("run-gcode");
  private pausePrinterAction = this.homey.flow.getActionCard("pause-print");
  private isOnlineCondition = this.homey.flow.getConditionCard("is-online");
  private isStatusCondition = this.homey.flow.getConditionCard("is-status");
  private shutDownPrinterAction = this.homey.flow.getActionCard("shut-down-printer");

  async onInit() {

    this.runGCodeAction.registerRunListener(async (args) => {
      return await args.device.runGcode(args.GCode);
    });

    this.pausePrinterAction.registerRunListener(async (args) => {
      return await args.device.pausePrinter();
    });

    this.isOnlineCondition.registerRunListener(async (args) => {
      return await args.device.isOnline();
    });

    this.isStatusCondition.registerRunListener(async (args) => {
      return (await args.device.getPrinterStatus() === args.status);
    });

    this.shutDownPrinterAction.registerRunListener(async (args) => {
      return await args.device.shutDownPrinter();
    });


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
