import Homey from 'homey';
import { MOONRAKER_EVENTS, MoonrakerAPI, PRINTER_STATUS } from '../../lib/moonraker';
import { LayerInfo } from '../../lib/domain/layerinfo';
import { equal } from 'assert';

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

    this.setCapabilityValue("printer_state", "Unknown");

    this.log('MoonrakerPrinter has been initialized');
  }

  async runGcode(gcode :  string) : Promise<void> {
    this.log(`Running GCODE: ${gcode}` );
    return this.moonraker.sendGCode(gcode);
  }

  isOnline() : boolean {
    return this.moonraker.getPrinterOnline();
  }

  getPrinterStatus() : string {
    return this.moonraker.getPrinterStatus();
  }

  async pausePrinter() : Promise<void> {
    if(this.moonraker.getPrinterStatus() === PRINTER_STATUS.PAUSED) {
      await this.runGcode("RESUME"); //should be configurable
      await this.setCapabilityValue("pause_print", false);
    }
    else if(this.moonraker.getPrinterStatus() === PRINTER_STATUS.PRINTING ) {
      await this.runGcode("PAUSE"); //should be configurable
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
      this.runGcode("CANCEL_PRINT"); //should be configurable
    }
    else {
      this.log("Unable to cancel print when it's not printing");
    }
  }

  async shutDownPrinter() : Promise<void>{
    return this.moonraker.shutDownPrinter();
  }

  async onMessage(data : string) {
    this.log(data);
  }

  async printerOffline() {
    if(!this.isUnknownState()) {
      await Promise.all([
        this.homey.flow.getDeviceTriggerCard("printer-offline").trigger(this),
        this.homey.flow.getTriggerCard("any-printer-offline").trigger({ 
          'printer-id': this.getName()
      })]);
    }
    await this.setCapabilityValue("printer_state", "Offline");
    await this.setUnavailable("Printer is offline");
    this.log("Printer offline: ", this.getName());
  }

  async printerConnected() {
    if(!this.isUnknownState()) { 
      await Promise.all([
        this.homey.flow.getDeviceTriggerCard("printer-online").trigger(this),
        this.homey.flow.getTriggerCard("any-printer-online").trigger({ 
          'printer-id': this.getName()
        })]);
    }
    await this.setCapabilityValue("printer_state", "Online");
    await this.setAvailable();
    this.log('Printer Online: ', this.getName());
  }

  isUnknownState() : boolean
  {
    return this.getCapabilityValue("printer_state") === "Unknown";
  }

  registerMoonrakerEvents() {
    this.moonraker.on(MOONRAKER_EVENTS.GENERIC_MESSAGE, (msg: any) => {this.onMessage(msg); });
    this.moonraker.on(MOONRAKER_EVENTS.PRINTER_ONLINE, () => this.printerConnected());
    this.moonraker.on(MOONRAKER_EVENTS.PRINTER_OFFLINE, () => this.printerOffline());
    
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_STARTED, () => { 
      this.homey.flow.getDeviceTriggerCard("print-started").trigger(this);
      this.setCapabilityValue("printer_state", "Printing");
    });
    
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_COMPLETED, () => {
      this.homey.flow.getTriggerCard("any-print-completed").trigger({ 
        'printer-id': this.getName(),
        'print-completed-duration': this.getCapabilityValue("print_total_time")
      });
      this.homey.flow.getDeviceTriggerCard("print-completed").trigger(this);
      this.setCapabilityValue("printer_state", "Online");
    });

    this.moonraker.on(MOONRAKER_EVENTS.PRINT_CANCELLED, () => this.homey.flow.getDeviceTriggerCard("print-cancelled").trigger(this));
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_DURATION, (dur: string) => this.setCapabilityValue("print_total_time", dur));
    this.moonraker.on(MOONRAKER_EVENTS.BED_TEMPERATURE, (tmp: number) => this.setCapabilityValue("printer_temperature_bed", tmp));
    this.moonraker.on(MOONRAKER_EVENTS.EXTRUDER_TEMPERATURE, (tmp: number) => this.setCapabilityValue("printer_temperature_tool", tmp));

    this.moonraker.on(MOONRAKER_EVENTS.PRINT_LAYERS, (layerinfo: LayerInfo) => {

      if(this.getCapabilityValue("print_current_layer") != layerinfo.currentLayer &&
         this.getCapabilityValue("print_current_layer") != "-") {
        this.homey.flow.getDeviceTriggerCard("print-layer-changed").trigger(this);
      }

      if(layerinfo.isLastLayer()) {
        this.homey.flow.getDeviceTriggerCard("print-on-last-layer");
      }

      this.setCapabilityValue("print_total_layers", layerinfo.totalLayers);
      this.setCapabilityValue("print_current_layer", layerinfo.currentLayer);
    });
    
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_PAUSED, () => { 
      this.homey.flow.getDeviceTriggerCard("print-paused").trigger(this);
      this.setCapabilityValue('pause_print', true);
    });
    
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_RESUMED, () => {
      this.homey.flow.getDeviceTriggerCard("print-resumed").trigger(this);
      this.setCapabilityValue("pause_print", false);
    });
    
    this.moonraker.on(MOONRAKER_EVENTS.PRINT_ERROR, (message: string) => {
      this.homey.flow.getDeviceTriggerCard("print-error").trigger(this, { "error-message": message })
      this.homey.flow.getTriggerCard("any-printer-error").trigger(
        {
          'printer-id': this.getName(),
          'error-msg': message
        }
      )
    });
    this.log('Registered for Moonraker Events');
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