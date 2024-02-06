import Homey from 'homey';
import { MOONRAKER_EVENTS, MoonrakerAPI, PRINTER_STATUS } from '../../lib/moonraker';

class MoonrakerPrinter extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  private moonraker!: MoonrakerAPI;

  async onInit() {
    this.log(this.getSettings());

    this.moonraker = new MoonrakerAPI(this.getSetting('address'), this.getSetting('port'));
    this.registerMoonrakerEvents();

    this.registerCapabilityListener("pause_print", async () => this.pausePrinter());
    this.registerCapabilityListener("cancel_print", async () => this.cancelPrint());

    this.log('MoonrakerPrinter has been initialized');
  }

  async runGcode(gcode :  string) : Promise<void> {
    this.log(`I want to run som gcode ${gcode}` );
    return this.moonraker.sendGCode(gcode);
  }

  isOnline() : boolean {
    return this.moonraker.getPrinterOnline();
  }

  async pausePrinter() : Promise<void> {
    if(this.moonraker.getPrinterStatus() === PRINTER_STATUS.PAUSED) {
      await this.runGcode("RESUME");
      await this.setCapabilityValue("pause_print", false);
    }
    else if(this.moonraker.getPrinterStatus() === PRINTER_STATUS.PRINTING ) {
      await this.runGcode("PAUSE");
      await this.setCapabilityValue("pause_print", true);
    }
    else {
      await this.setCapabilityValue("pause_print", false);
      this.log("Unable to pause when printer is not printing");
    }
  }

  async cancelPrint() {
    let printerStatus = this.moonraker.getPrinterStatus();
    if(printerStatus === PRINTER_STATUS.PAUSED ||
       printerStatus === PRINTER_STATUS.PRINTING) {
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
    await this.homey.flow.getDeviceTriggerCard("printer-offline").trigger(this);
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
    
    this.moonraker.on(MOONRAKER_EVENTS.GENERIC_MESSAGE, (msg: any) => {this.onMessage(msg); });
    this.moonraker.on(MOONRAKER_EVENTS.PRINTER_ONLINE, () => this.printerConnected());
    this.moonraker.on(MOONRAKER_EVENTS.PRINTER_OFFLINE, () => this.printerOffline());
    this.moonraker.on(MOONRAKER_EVENTS.UPDATE_PRINTER_STATE, (state: string) => this.printerStateUpdated(state));
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_STARTED, () => this.homey.flow.getDeviceTriggerCard("print-started").trigger(this));
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_COMPLETED, () => this.homey.flow.getDeviceTriggerCard("print-completed").trigger(this));
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_CANCELED, () => this.homey.flow.getDeviceTriggerCard("print-cancelled").trigger(this));
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_DURATION, (dur: string) => this.setCapabilityValue("print_total_time", dur));
    this.moonraker.on(MOONRAKER_EVENTS.BED_TEMPERATURE, (tmp: number) => this.setCapabilityValue("printer_temperature_bed", tmp));
    this.moonraker.on(MOONRAKER_EVENTS.EXTRUDER_TEMPERATURE, (tmp: number) => this.setCapabilityValue("printer_temperature_tool", tmp));

    this.moonraker.on(MOONRAKER_EVENTS.PRINT_LAYERS, (layerinfo: any) => {
      this.setCapabilityValue("print_total_layers", layerinfo.total_layer);
      this.setCapabilityValue("print_current_layer", layerinfo.current_layer);
    });
    
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_PAUSED, () => { 
      this.homey.flow.getDeviceTriggerCard("print-paused").trigger(this);
      this.setCapabilityValue('pause_print', true);
    });
    
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_RESUMED, () => {
      this.homey.flow.getDeviceTriggerCard("print-resumed").trigger(this);
      this.setCapabilityValue("pause_print", false);
    });
    
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_ERROR, (message: string) => this.homey.flow.getDeviceTriggerCard("print-error").trigger(this, { "error-message": message }));
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