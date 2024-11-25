
import fetch from "node-fetch"; 
import WebSocket from "ws";
import EventEmitter from "events";
import { LayerInfo } from "./domain/layerinfo";
import { TimeTools } from "./utils/timetools";


enum MOONRAKER_EVENTS {
    PRINT_ERROR = "PrintError",
    PRINT_CANCELLED = "PrintCancelled",
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
    PRINTER_STANDBY = "PrinterStansby",
    GENERIC_MESSAGE = "message"
}

//Based on Moonraker print_stats object. Added offline.
enum PRINTER_STATUS {
    PRINTING = "printing",
    COMPLETE = "complete",
    ERROR = "error",
    CANCELLED = "cancelled",
    PAUSED = "paused",
    STANDBY = "standby",
    OFFLINE = "offline",
    UNKNOWN = "unknown"
}

class MoonrakerAPI extends EventEmitter {

    private readonly TIMEOUT_VALUE: number = 5000;
    private readonly GCODE_TIMEOUT_VALUE: number = 60000;
    private readonly POLL_INTERVAL: number = 10000;
    private readonly POLL_EVENT: string = "poll"

    private ws!: WebSocket;
    private ip: string;
    private port: number;
    private printerOnline: boolean = false;
    private printerStatus: string = PRINTER_STATUS.UNKNOWN;

    private timerHandle!: NodeJS.Timeout;

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
        if(this.ws) {
            this.ws.close();
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
                case PRINTER_STATUS.CANCELLED:
                    this.emit(MOONRAKER_EVENTS.PRINT_CANCELLED);
                    break;
                case PRINTER_STATUS.PAUSED:
                    this.emit(MOONRAKER_EVENTS.PRINT_PAUSED);
                    break;
                case PRINTER_STATUS.OFFLINE:
                    this.emit(MOONRAKER_EVENTS.PRINTER_OFFLINE);
                    break;
                case PRINTER_STATUS.STANDBY:
                    this.emit(MOONRAKER_EVENTS.PRINTER_STANDBY);
                    break;
                default:
                    console.log("Unknown printer state : " + status);
                    break;
            }
            this.printerStatus = status;
        }
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
                        this.emit(MOONRAKER_EVENTS.PRINT_DURATION, TimeTools.toHHMMSS(val.print_stats.total_duration));
                    }
                    if("info" in val.print_stats) {
                        this.emit(MOONRAKER_EVENTS.PRINT_LAYERS, new LayerInfo(val.print_stats.info.current_layer, val.print_stats.info.total_layer));
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
        else if(msg.id) {
            this.emit(msg.id.toString(), msg);
        }
        else if(msg.result?.status?.print_stats?.state !== undefined) {
            this.updatePrinterStatus(msg.result.status.print_stats.state);
        }
        else {
            this.emit(MOONRAKER_EVENTS.GENERIC_MESSAGE, msg);
        }
        
        this.resetTimer();
    }

    private connectToPrinterWebSocket() : void {
        this.ws = new WebSocket(`ws://${this.ip}:${this.port}/websocket`);

        this.ws.on('message', (msg: any) => this.readMessage(msg));
        
        this.ws.on('error', (msg: any) => console.error("On.Error\n" + msg));
        
        this.ws.on('open', () => { 
            this.subscribeToPrintObjects();
        });

        this.ws.on('close', (msg : any) => { 
            console.log("On.Close");
            this.connectionClosed(msg);
            new Promise(resolve => setTimeout(() => { this.emit(this.POLL_EVENT)}, this.POLL_INTERVAL ) );
         });
    }

    private connectionClosed(msg : string) : void {
        console.log("Closing connection : " + msg);

        if(!(this.printerStatus === PRINTER_STATUS.OFFLINE))
        {
            if(this.timerHandle) { 
                clearTimeout(this.timerHandle); 
            }
            this.printerOnline = false;
            this.ws.removeAllListeners();
            if(this.ws.readyState !== WebSocket.CONNECTING) {
                this.ws.terminate();
            }
            this.updatePrinterStatus(PRINTER_STATUS.OFFLINE);
        }
    }

    async sendGCode(code : string): Promise<void>
    {
        let time = Date.now();
        const obj = {
            "jsonrpc": "2.0",
            "method": "printer.gcode.script",
            "params": {
                "script": code
            },
            "id": time
        };
        return await new Promise((resolve, reject) => {
            this.once(time.toString(), resolve);
            this.sendMsg(obj).catch(() => reject);
            setTimeout(reject, this.GCODE_TIMEOUT_VALUE);
        });
    }

    async queryPrinterStatus() : Promise<string>
    {
        const query = {
            "jsonrpc": "2.0",
            "method": "printer.objects.query",
            "params": {
                "objects": {
                    "print_stats": ["state", "message"]
                }
            },
            "id": 5000
        };

        return await new Promise((resolve, reject) => {
            this.once("5000", (data) => {
                console.log(data);
                this.updatePrinterStatus(data.result.status.print_stats.state, data.result.status.print_stats.message);
                return resolve;
            })
            this.sendMsg(query).catch(() => reject);
        });
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

        await this.sendMsg(obj).catch(() => {console.error("Unable to subscribe to print objects")});
        this.emit(MOONRAKER_EVENTS.PRINTER_ONLINE);
        this.printerOnline = true;
        this.queryPrinterStatus();
        this.resetTimer();
    }

    private async sendMsg(msg: object) : Promise<void>
    {
        try {
            if (this.ws.OPEN) {
                this.ws.send(JSON.stringify(msg));
            }
            else {
                console.log(this.ws.readyState);
                return Promise.reject("Connection not Open");
            }
        } catch (error) {
            return Promise.reject("failed");
        }
        return Promise.resolve();
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
        this.connectToPrinterWebSocket();
        console.log("Trying to connect to printer");
    }

    private resetTimer(): void {
        if(this.timerHandle) {
            this.timerHandle.refresh();
        }
        else {
            this.timerHandle = setTimeout(() =>  this.connectionClosed("Timeout"), this.TIMEOUT_VALUE);
        }
    }
}

export {MoonrakerAPI};
export {MOONRAKER_EVENTS};
export {PRINTER_STATUS};