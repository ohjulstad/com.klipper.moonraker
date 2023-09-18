import Homey from 'homey';
import { MoonrakerAPI } from '../../lib/moonraker';

class MoonrakerPrinter extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  private moonraker!: MoonrakerAPI;
  private poll!: boolean;

  async onInit() {
    this.log(this.getSettings());

    this.poll = false;

    this.moonraker = new MoonrakerAPI(this.getSetting('address'));
    this.registerMoonrakerEvents();

    this.registerCapabilityListener("pause_print", async () => this.pausePrinter());
    this.registerCapabilityListener("cancel_print", async () => this.cancelPrint());

    this.log('MoonrakerPrinter has been initialized');
  }

  async runGcode(gcode :  string) {
    this.log(`I want to run som gcode ${gcode}` );
    this.moonraker.sendGCode(gcode);
  }

  async pausePrinter() {
    if(this.moonraker.getPrinterStatus() === "paused") {
      this.runGcode("RESUME");
      await this.setCapabilityValue("pause_print", false);
    }
    else if(this.moonraker.getPrinterStatus() === "printing" ) {
      this.runGcode("PAUSE");
      await this.setCapabilityValue("pause_print", true);
    }
    else {
      await this.setCapabilityValue("pause_print", false);
      this.log("Unable to pause when printer is not printing");
    }
  }

  async cancelPrint() {
    let printerStatus = this.moonraker.getPrinterStatus();
    if(printerStatus === "paused" ||
       printerStatus === "printing") {
      this.runGcode("CANCEL_PRINT");
    }
    else {
      this.log("Unable to cancel print when it's not printing");
    }
  }

  async onMessage(data : string) {
    this.log(data);
  }

  async printerOffline() {
    this.homey.flow.getDeviceTriggerCard("printer-offline").trigger(this);
    this.log("Printer went offline");
  }

  async printerConnected() {
    await this.homey.flow.getDeviceTriggerCard("printer-online").trigger(this);
  }

  async printerStateUpdated(state: string) {
    if(!this.getAvailable()) {
      this.setAvailable();
    }
    const stateMsg = state.charAt(0).toUpperCase() + state.slice(1);
    await this.setCapabilityValue("printer_state", stateMsg);
    this.log("Updated printer state : " + stateMsg);
  }

  registerMoonrakerEvents() {
    this.moonraker.on("message", (msg: any) => {this.onMessage(msg); });
    this.moonraker.on("PrinterConnected", () => this.printerConnected());
    this.moonraker.on("PrinterOffline", () => this.printerOffline());
    this.moonraker.on("UpdatedPrinterState", (state: string) => this.printerStateUpdated(state));
    this.moonraker.on("PrintStarted", () => this.homey.flow.getDeviceTriggerCard("print-started").trigger(this));
    this.moonraker.on("PrintCompleted", () => this.homey.flow.getDeviceTriggerCard("print-completed").trigger(this));
    this.moonraker.on("PrintCancelled", () => this.homey.flow.getDeviceTriggerCard("print-cancelled").trigger(this));
    this.moonraker.on("TotalDurationUpdated", (dur: string) => this.setCapabilityValue("print_total_time", dur));
    this.moonraker.on("BedTemperature", (tmp: number) => this.setCapabilityValue("printer_temperature_bed", tmp));
    this.moonraker.on("ExtruderTemperature", (tmp: number) => this.setCapabilityValue("printer_temperature_tool", tmp));

    this.moonraker.on("LayersUpdated", (layerinfo: any) => {
      this.setCapabilityValue("print_total_layers", layerinfo.total_layer);
      this.setCapabilityValue("print_current_layer", layerinfo.current_layer);
    });
    
    this.moonraker.on("PrintPaused", () => { 
      this.homey.flow.getDeviceTriggerCard("print-paused").trigger(this);
      this.setCapabilityValue('pause_print', true);
    });
    
    this.moonraker.on("PrintResumed", () => {
      this.homey.flow.getDeviceTriggerCard("print-resumed").trigger(this);
      this.setCapabilityValue("pause_print", false);
    });
    
    this.moonraker.on("PrintError", (message: string) => this.homey.flow.getDeviceTriggerCard("print-error").trigger(this, { "error-message": message }));
  }


  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('Klipper 3D printer has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log("Klipper 3D printer settings where changed");
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('Klipper 3D printer was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.moonraker.closeConnection();
    this.moonraker.removeAllListeners();
    this.log('Klipper 3D printer has been deleted');
  }
}

module.exports = MoonrakerPrinter;