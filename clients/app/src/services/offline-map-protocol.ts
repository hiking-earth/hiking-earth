import {addProtocol} from 'maplibre-gl';
import {Protocol,type PMTiles} from 'pmtiles';
const protocol=new Protocol();
addProtocol('pmtiles',protocol.tile);
export function registerOfflineArchive(archive:PMTiles){protocol.add(archive);}
export function releaseOfflineArchive(key:string){protocol.tiles.delete(key);}
