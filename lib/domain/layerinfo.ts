class LayerInfo {

    private _currentLayer: string;
    private _totalLayers: string;

    constructor(currentLayer: string, totalLayers: string){
        this._currentLayer = currentLayer;
        this._totalLayers = totalLayers;
    }

    public get currentLayer() : string {
        return this._currentLayer;
    }
    public set currentLayer(layer: string) {
        this._currentLayer = layer;
    }

    public get totalLayers() : string {
        return this._totalLayers;
    }
    public set totalLayers(totLayers : string) {
        this._totalLayers = totLayers;
    }

    public isLastLayer(): boolean {
        if(this._currentLayer != "-" || this._totalLayers != "-") {
            return this._currentLayer == this._totalLayers;
        }
        return false;
    }
}

export {LayerInfo};