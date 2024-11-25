class TimeTools
{
    public static toHHMMSS(seconds: number) : string {
        let hour = Math.floor(seconds / 3600 );
        let min = Math.floor((seconds - (hour * 3600)) / 60);
        let sec = Math.floor((seconds - (hour * 3600) - (min * 60)));
        return hour.toString().padStart(2, '0')+":"+min.toString().padStart(2, '0')+":"+sec.toString().padStart(2, '0');
    }
}

export {TimeTools};

