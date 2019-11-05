import {FileOpenerOriginal} from "@ionic-native/file-opener";
import {DirectoryEntry, File, FileEntry, RemoveResult} from "@ionic-native/file/ngx";
import {IOError} from "../../error/errors";
import {CantOpenFileTypeException} from "../../exceptions/CantOpenFileTypeException";
import {Logger} from "../logging/logging.api";
import {Logging} from "../logging/logging.service";
import {Filesystem} from "./filesystem.service";
import { Platform } from "@ionic/angular";

interface PathTuple {
    readonly absoluteBasePath: string;
    readonly target: string;
}

/**
 * Abstract base implementation for mobile filesystem implementations (iOS, Android)
 *
 * @author Nicolas Schäfli <ns@studer-raimann.ch>
 * @version 1.0.0
 */
abstract class AbstractCordovaFilesystem implements Filesystem {

    constructor(
        protected readonly file: File
    ) {}

    async delete(path: string): Promise<RemoveResult> {
        const pathInfo: PathTuple = await this.getAbsolutePathInfo(path);
        return this.file.removeRecursively(pathInfo.absoluteBasePath, pathInfo.target);
    }

    async exists(path: string): Promise<boolean> {
        const pathInfo: PathTuple = await this.getAbsolutePathInfo(path);
        return (await this.file.checkFile(pathInfo.absoluteBasePath, pathInfo.target)) ||
            this.file.checkDir(pathInfo.absoluteBasePath, pathInfo.target);
    }

    protected async getDirectory(path: string): Promise<DirectoryEntry> {
        const pathInfo: PathTuple = await this.getAbsolutePathInfo(path);
        return this.file.getDirectory(
            await this.file.resolveDirectoryUrl(pathInfo.absoluteBasePath),
            pathInfo.target,
            {create: false, exclusive: false}
            );
    }

    protected async getFile(path: string): Promise<FileEntry> {
        const pathInfo: PathTuple = await this.getAbsolutePathInfo(path);
        return this.file.getFile(
            await this.getDirectory(pathInfo.absoluteBasePath),
            pathInfo.target,
            {create: false, exclusive: false}
        );
    }

    async save(path: string, data: ArrayBuffer): Promise<FileEntry> {
        const pathInfo: PathTuple = await this.getAbsolutePathInfo(path);
        return this.file.writeFile(pathInfo.absoluteBasePath, pathInfo.target, data, {replace: true});
    }

    abstract open(path: string, type?: string): Promise<void>;

    /**
     * Returns the OS Specific absolute base path.
     * The path must not end with a "/" or "\".
     *
     * @return {Promise<string>} - The OS specific base path.
     */
    protected abstract getFilesystemBasePath(): Promise<string>;

    protected async getAbsolutePathInfo(path: string): Promise<PathTuple> {
        const pathFolders: Array<string> = Array.from([
            await this.getFilesystemBasePath(),
            ...path.split("/")
        ]);
        const targetName: string | undefined = pathFolders.pop();

        if (typeof targetName !== "string" || targetName.length > 0) {
            throw new IOError(`Invalid path, unable to extract directory/file name. Got path "${path}" and directory/file "${targetName}".`);
        }

        return {
            absoluteBasePath: pathFolders.join("/"),
            target: targetName
        };
    }
}

export class AndroidFilesystem extends AbstractCordovaFilesystem {

    private log: Logger = Logging.getLogger("AndroidFilesystem");


    constructor(
        file: File,
        private readonly fileOpener: FileOpenerOriginal
    ) {
        super(file);
    }

    protected async getFilesystemBasePath(): Promise<string> {
        return this.file.externalApplicationStorageDirectory;
    }

    async open(path: string, type: string = ""): Promise<void> {

        try {
            this.log.debug(() => `Opening file in default application on Android: "${path}"`);
            const pathInfo: PathTuple = await this.getAbsolutePathInfo(path);
            await this.fileOpener.open(
                `${pathInfo.absoluteBasePath}/${pathInfo.target}`, type);
            this.log.trace(() => "Existing file successfully opened on Android.");
        } catch (e) {
            if (e.status === 9) {
                this.log.error(() => "Unable to open existing file on Android because the file type is not supported.");
                throw new CantOpenFileTypeException("Unable to open existing file on Android because the file type is not supported.");
            }
            else {
                this.log.error(() => "Unable to open existing file on Android with a general error.");
                throw e;
            }
        }
    }
}

export class IOSFilesystem extends AbstractCordovaFilesystem {

    private log: Logger = Logging.getLogger("IOSFilesystem");

    protected async getFilesystemBasePath(): Promise<string> {
        return this.file.dataDirectory;
    }

    async open(path: string, type?: string): Promise<void> {

        const url: string = (await this.getFile(path)).toURL();
        this.log.debug(() => `Opening file in default application on iOS: "${url}"`);
        await this.previewFileFromUrlOrPath(url);
    }

    private async previewFileFromUrlOrPath(url: string, type?: string): Promise<void> {
        return new Promise((resolve): void => {
            window["DocumentViewer"].previewFileFromUrlOrPath(
                (msg) => {
                    this.log.trace(() => `Existing file successfully opened on iOS with message "${msg}"`);
                    resolve();
                },
                (errorCode) => {
                    this.log.error(() => `Unable to open existing file on iOS with error code: "${errorCode}"`);
                    throw new CantOpenFileTypeException(`Unable to open existing file on iOS with error code: "${errorCode}"`);
                },
                url,
                type
            );
        });
    }
}

export const CORDOVA_FILESYSTEM_FACTORY: (platform: Platform, file: File, fileOpener: FileOpenerOriginal) => void =
    (platform: Platform, file: File, fileOpener2: FileOpenerOriginal): Filesystem => {
    if(platform.is("android")) {
        return new AndroidFilesystem(file, fileOpener2);
    }

    if (platform.is("ios")) {
        return new IOSFilesystem(file);
    }

    throw new Error("Cordova filesystem factory found no suitable implementation for the current platform.")
};
