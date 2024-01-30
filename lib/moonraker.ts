
import fetch from "node-fetch"; 
import WebSocket from "ws";
import EventEmitter from "events";


enum MOONRAKER_EVENTS {
    PRINT_ERROR = "PrintError",
    PRINT_CANCELED = "PrintCancelled",
    PRINT_PAUSED = "PrintPaused",
    PRINT_COMPLETED = "PrintCompleted",
    PRINT_RESUMED = "PrintResumed",
    PRINT_STARTED = "PrintStarted",
    UPDATE_PRINTER_STATE = "UpdatedPrinterState",
    EXTRUDER_TEMPERATURE = "ExtruderTemperature",
    BED_TEMPERATURE = "BedTemperature",
    PRINT_DURATION = "PrintDuration",
    PRINT_LAYERS = "PrintLayers",
    PRINTER_OFFLINE = "PrinterOffline",
    PRINTER_ONLINE = "PrinterOnline",
    GENERIC_MESSAGE = "message"
}

//Based on Moonraker print_stats object. Added offline.
enum PRINTER_STATUS {
    PRINTING = "printing",
    COMPLETE = "complete",
    ERROR = "error",
    CANCELED = "cancelled",
    PAUSED = "paused",
    STANDBY = "standby",
    OFFLINE = "offline",
    UNKNOWN = "unknown"
}

class MoonrakerAPI extends EventEmitter {

    private readonly TIMEOUT_VALUE: number = 5000;
    private readonly POLL_INTERVAL: number = 10000;
    private readonly POLL_EVENT: string = "poll"

    private wss!: WebSocket;
    private ip: string;
    private port: number;
    private printerOnline: boolean = false;
    private printerStatus: string = PRINTER_STATUS.UNKNOWN;

    private timerHandle!: ReturnType<typeof setTimeout>;

    constructor(ip : string, port : number,  startConnect : boolean = true) {
        super();

        this.ip = ip;
        this.port = port;
        
        this.on(this.POLL_EVENT, () => this.pollPrinter());
        if(startConnect) {
            this.emit(this.POLL_EVENT);
        }
    }

    public getPrinterOnline() : boolean {
        return this.printerOnline;
    }

    public getPrinterStatus() : string {
        return this.printerStatus;
    }

    public closeConnection() : void {
        if(this.wss) {
            this.wss.close();
        }
    }


    private updatePrinterStatus(status: string, message: string = "") : void {
        if(this.printerStatus != status) {
            switch (status) {
                case PRINTER_STATUS.PRINTING:
                    this.printerStatus === PRINTER_STATUS.PAUSED ? this.emit(MOONRAKER_EVENTS.PRINT_RESUMED) : this.emit(MOONRAKER_EVENTS.PRINT_STARTED);
                    break;
                case PRINTER_STATUS.COMPLETE:
                    this.emit(MOONRAKER_EVENTS.PRINT_COMPLETED);
                    break;
                case PRINTER_STATUS.ERROR:
                    this.emit(MOONRAKER_EVENTS.PRINT_ERROR, message);
                    break;
                case PRINTER_STATUS.CANCELED:
                    this.emit(MOONRAKER_EVENTS.PRINT_CANCELED);
                    break;
                case PRINTER_STATUS.PAUSED:
                    this.emit(MOONRAKER_EVENTS.PRINT_PAUSED);
                    break;
                default:
                    break;
            }
            this.emit(MOONRAKER_EVENTS.UPDATE_PRINTER_STATE, status);
            this.printerStatus = status;
        }
    }

    private toHHMMSS(seconds: number) : string {
        let hour = Math.floor(seconds / 3600 );
        let min = Math.floor((seconds - (hour * 3600)) / 60);
        let sec = Math.floor((seconds - (hour * 3600) - (min * 60)));
        return hour.toString().padStart(2, '0')+":"+min.toString().padStart(2, '0')+":"+sec.toString().padStart(2, '0');
    }

    private readMessage(data : string) : void  {

        const msg  = JSON.parse(data);

        if(msg.method === 'notify_proc_stat_update') {
            return;
        } //Ignore spam.)
        
        else if(msg.method === 'notify_status_update') {
            msg.params.forEach((val: any)  => {
                if(typeof val === 'object' && 'print_stats' in val) {
                    if("state" in val.print_stats) {
                        this.updatePrinterStatus(val.print_stats.state, val.print_stats.message);
                    }
                    if("total_duration" in val.print_stats) {
                        this.emit(MOONRAKER_EVENTS.PRINT_DURATION, this.toHHMMSS(val.print_stats.total_duration));
                    }
                    if("info" in val.print_stats) {
                        this.emit(MOONRAKER_EVENTS.PRINT_LAYERS, val.print_stats.info );
                    }
                }

                if(typeof val === 'object' && 'heater_bed' in val) {
                    this.emit(MOONRAKER_EVENTS.BED_TEMPERATURE, val.heater_bed.temperature);                    
                }

                if(typeof val === 'object' && 'extruder' in val) {
                    this.emit(MOONRAKER_EVENTS.EXTRUDER_TEMPERATURE, val.extruder.temperature);
                } 
            });
        }
        else if(msg.method === 'notify_klippy_shutdown') {
            this.updatePrinterStatus(PRINTER_STATUS.ERROR, "Klipper Shutdown");
        }
        else if(msg.method === 'notify_klippy_ready') {
            this.updatePrinterStatus(PRINTER_STATUS.STANDBY);
        }
        else if(msg.result?.status?.print_stats?.state !== undefined) {
            this.updatePrinterStatus(msg.result.status.print_stats.state);
        }
        else {
            this.emit(MOONRAKER_EVENTS.GENERIC_MESSAGE, msg);
        }
        
        this.resetTimer();
    }

    private async connectToPrinterWebSocket() {
        this.wss = new WebSocket(`ws://${this.ip}:${this.port}/websocket`);

        this.wss.on('message', (msg: any) => this.readMessage(msg));
        this.wss.on('error', (msg: any) => console.error(msg));
        this.wss.on('open', () => this.subscribeToPrintObjects());
        this.wss.on('close', (msg : any) => this.connectionClosed(msg));

    }

    private connectionClosed(msg : any) : void {

        if(this.timerHandle) {
            clearTimeout(this.timerHandle);
        }

        this.updatePrinterStatus(PRINTER_STATUS.OFFLINE);
        this.printerOnline = false;
        this.emit(MOONRAKER_EVENTS.PRINTER_OFFLINE);
        this.emit(this.POLL_EVENT);
        this.wss.removeAllListeners();
        this.wss.terminate();
    }

    async sendGCode(code : string): Promise<void>
    {
        const obj = {
            "jsonrpc": "2.0",
            "method": "printer.gcode.script",
            "params": {
                "script": code
            },
            "id": 1234
        }
        this.wss.send(JSON.stringify(obj));
    }

    private async subscribeToPrintObjects() : Promise<void>
    {
        const obj = {
            "jsonrpc": "2.0",
            "method": "printer.objects.subscribe",
            "params": {
                "objects": {
                    "print_stats": ["state", "message", "total_duration", "info"],
                    "heater_bed": ["temperature"],
                    "extruder": ["temperature"]
                }
            },
            "id": 5434
        }

        this.wss.send(JSON.stringify(obj));
        this.emit(MOONRAKER_EVENTS.PRINTER_ONLINE);
        this.printerOnline = true;
    }

    public async getPrinterInfo() : Promise<string> {
        let result = "Offline";

        await this.getApiData("/printer/info")
        .then(res => {
            if(res.result) { result = res.result; }
        })
        .catch(err => { return err; })
        return result;
    }

    private async getApiData(path: string) : Promise<any> {
        const uri = `http://${this.ip}${path}`

        let pr = new Promise(function (resolve, reject) {
            fetch(uri)
            .then(result => {
                if(result.status === 200) { return result.json(); } 
                return false;
            })
            .then(json => { return resolve(json); })
            .catch(err => { return reject(err) })
        });
        return pr;
    }

    private async pollPrinter(): Promise<void> {
        while(!this.printerOnline) {
            await this.getPrinterInfo()
            .then(async result => {
                if(result != "Offline") {
                    await this.connectToPrinterWebSocket()
                    .catch(err => {console.log(err)});
                }
                else {
                    this.updatePrinterStatus(PRINTER_STATUS.OFFLINE, "Unable to Connect");
                }
            });
            await new Promise(resolve => setTimeout(resolve, this.POLL_INTERVAL));
        }
    }

    private resetTimer(): void {
        if(this.timerHandle) {
            this.timerHandle.refresh();
        }
        else {
            this.timerHandle = setTimeout(() => this.connectionClosed("Timeout"), this.TIMEOUT_VALUE);
        }
    }
}

export {MoonrakerAPI};
export {MOONRAKER_EVENTS};
export {PRINTER_STATUS};