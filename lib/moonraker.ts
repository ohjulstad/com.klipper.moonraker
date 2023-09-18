
import fetch from "node-fetch"; 
import WebSocket from "ws";
import EventEmitter from "events";

class MoonrakerAPI extends EventEmitter {

    private wss!: WebSocket;
    private host: string;
    private printerOnline: boolean = false;
    private printerStatus: string = "Unknown";
    private printerObjects: string[];

    private timerHandle!: ReturnType<typeof setTimeout>;

    constructor(host : string, startConnect : boolean = true) {
        super();

        this.printerObjects = ["print_stats"];

        this.host = host;
        
        if (!/^(?:f|ht)tps?\:\/\//.test(host)) {
            this.host = "http://" + host;
        }
        
        this.on("poll", () => this.pollPrinter());
        if(startConnect) {
            this.emit("poll");
        }
    }

    /**
     * name
     */
    public getPrinterStatus() : string {
        return this.printerStatus;
    }


    private updatePrinterStatus(status: string, message: string = "") : void {
        if(this.printerStatus != status) {
            switch (status) {
                case "printing":
                    this.printerStatus === "paused" ? this.emit("PrintResumed") : this.emit("PrintStarted");
                    break;
                case "complete":
                    this.emit("PrintCompleted");
                    break;
                case "error":
                    this.emit("PrintError", message);
                    break;
                case "cancelled":
                    this.emit("PrintCancelled");
                    break;
                case "paused":
                    this.emit("PrintPaused");
                    break;
                default:
                    break;
            }
            this.emit("UpdatedPrinterState", status);
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

        this.resetTimer();

        const msg  = JSON.parse(data);
        if(msg.method === 'notify_proc_stat_update') {
        } //Ignore spam.)

        else if(msg.method === 'notify_status_update') {
            msg.params.forEach((val: any)  => {
                if(typeof val === 'object' && 'print_stats' in val) {
                    if("state" in val.print_stats) {
                        this.updatePrinterStatus(val.print_stats.state, val.print_stats.message);
                    }
                    if("total_duration" in val.print_stats) {
                        this.emit("TotalDurationUpdated", this.toHHMMSS(val.print_stats.total_duration));
                    }
                    if("info" in val.print_stats) {
                        this.emit("LayersUpdated", val.print_stats.info );
                    }
                }

                if(typeof val === 'object' && 'heater_bed' in val) {
                    this.emit("BedTemperature", val.heater_bed.temperature);                    
                }

                if(typeof val === 'object' && 'extruder' in val) {
                    this.emit("ExtruderTemperature", val.extruder.temperature);
                } 
            });
        }
        else if(msg.method === 'notify_klippy_shutdown') {
            this.updatePrinterStatus("error", "Klipper Shutdown");
        }
        else if(msg.method === 'notify_klippy_ready') {
            this.updatePrinterStatus("standby");
        }
        else if(msg.result?.status?.print_stats?.state !== undefined) {
            this.updatePrinterStatus(msg.result.status.print_stats.state);
        }
        else {
            this.emit("message", msg);
        }
    }

    private async connectToPrinterWebSocket() {
        this.wss = new WebSocket("ws://192.168.10.36:7125/websocket");

        this.wss.on('message', (msg: any) => this.readMessage(msg));
        this.wss.on('error', (msg: any) => console.error(msg));
        this.wss.on('open', () => this.subscribeToPrintObjects());
        this.wss.on('close', (msg : any) => this.connectionClosed(msg));

    }

    private connectionClosed(msg : any) : void {

        if(this.timerHandle) {
            clearTimeout(this.timerHandle);
        }

        this.updatePrinterStatus("offline");
        this.printerOnline = false;
        this.emit('PrinterOffline');
        this.emit('poll');
        this.wss.removeAllListeners();
        this.wss.terminate();
    }

    async sendGCode(code : string)
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
    }

    public async getPrinterInfo() : Promise<string> {
        let result = "Offline";
        const endpoint = this.host+"/printer/info";

        await this.getApiData("/printer/info")
        .then(res => {
            if(res.result?.state) { result = res.result.state; }
        })
        .catch(err => { return err; })

        return result;
    }

    private async getApiData(path: string) : Promise<any> {
        const uri = this.host + path

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

    private async pollPrinter() {
        while(!this.printerOnline) {
            await this.getPrinterInfo()
            .then(result => {
                if(result != "Offline") {
                    this.printerOnline = true;
                    this.connectToPrinterWebSocket();
                }
            });
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }

    private resetTimer() {
        if(this.timerHandle) {
            this.timerHandle.refresh();
        }
        else {
            this.timerHandle = setTimeout(() => this.connectionClosed("Timeout"), 5000);
        }
    }
}

export {MoonrakerAPI};