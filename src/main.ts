import * as core from '@actions/core'
import * as fs from "fs"
import { runUpload } from "./edits"
import {
    validateInAppUpdatePriority,
    validateReleaseFiles,
    validateStatus,
    validateTracks,
    validateUserFraction
} from "./input-validation"
import { unlink, writeFile } from 'fs/promises'
import pTimeout from 'p-timeout'

export async function run() {
    let cleanupCredentialsFile = false
    try {
        const serviceAccountJson = core.getInput('serviceAccountJson', { required: false });
        const serviceAccountJsonRaw = core.getInput('serviceAccountJsonPlainText', { required: false});
        const packageName = core.getInput('packageName', { required: true });
        const releaseFile = core.getInput('releaseFile', { required: false });
        const releaseFiles = core.getInput('releaseFiles', { required: false })
            ?.split(',')
            ?.filter(x => x !== '') ?? [];
        const releaseName = core.getInput('releaseName', { required: false });
        const track = core.getInput('track', { required: false });
        const tracks = core.getInput('tracks', { required: false })
            ?.split(',')
            ?.filter(x => x !== '') ?? [];
        const inAppUpdatePriority = core.getInput('inAppUpdatePriority', { required: false });
        const userFraction = core.getInput('userFraction', { required: false })
        const status = core.getInput('status', { required: false });
        const whatsNewDir = core.getInput('whatsNewDirectory', { required: false });
        const mappingFile = core.getInput('mappingFile', { required: false });
        const debugSymbols = core.getInput('debugSymbols', { required: false });
        const changesNotSentForReview = core.getInput('changesNotSentForReview', { required: false }) == 'true';
        const existingEditId = core.getInput('existingEditId');
        const versionCodesToRetain = core.getInput('versionCodesToRetain', { required: false })
            ?.split(',')
            ?.filter(x => x !== '')
            ?.map(x => parseInt(x))
            ?.filter(x => !Number.isNaN(x));

        cleanupCredentialsFile = await validateServiceAccountJson(serviceAccountJsonRaw, serviceAccountJson)

        // Validate user fraction
        let userFractionFloat: number | undefined
        if (userFraction) {
            userFractionFloat = parseFloat(userFraction)
        } else {
            userFractionFloat = undefined
        }
        await validateUserFraction(userFractionFloat)

        // Validate release status
        await validateStatus(status, userFractionFloat != undefined && !isNaN(userFractionFloat))

        // Validate the inAppUpdatePriority to be a valid number in within [0, 5]
        let inAppUpdatePriorityInt: number | undefined
        if (inAppUpdatePriority) {
            inAppUpdatePriorityInt = parseInt(inAppUpdatePriority)
        } else {
            inAppUpdatePriorityInt = undefined
        }
        await validateInAppUpdatePriority(inAppUpdatePriorityInt)

        const validatedReleaseFiles: string[] = await validateReleaseFiles(releaseFile, releaseFiles)

        const validatedTracks: string[] = await validateTracks(track, tracks)

        if (whatsNewDir != undefined && whatsNewDir.length > 0 && !fs.existsSync(whatsNewDir)) {
            core.warning(`Unable to find 'whatsnew' directory @ ${whatsNewDir}`);
        }

        if (mappingFile != undefined && mappingFile.length > 0 && !fs.existsSync(mappingFile)) {
            core.warning(`Unable to find 'mappingFile' @ ${mappingFile}`);
        }

        if (debugSymbols != undefined && debugSymbols.length > 0 && !fs.existsSync(debugSymbols)) {
            core.warning(`Unable to find 'debugSymbols' @ ${debugSymbols}`);
        }

        await pTimeout(
            runUpload(
                packageName,
                validatedTracks,
                inAppUpdatePriorityInt,
                userFractionFloat,
                whatsNewDir,
                mappingFile,
                debugSymbols,
                releaseName,
                changesNotSentForReview,
                existingEditId,
                status,
                validatedReleaseFiles,
                versionCodesToRetain
            ),
            {
                milliseconds: 3.6e+6
            }
        )
    } catch (error: unknown) {
        core.setFailed(formatError(error))
    } finally {
        if (cleanupCredentialsFile) {
            // Cleanup our auth file that we created.
            core.debug('Cleaning up service account json file');
            try {
                await unlink('./serviceAccountJson.json');
            } catch (cleanupError: unknown) {
                // Cleanup failure should be visible in debug logs but never hide the upload failure.
                core.debug(`Failed to cleanup generated service account json file: ${formatError(cleanupError)}`)
            }
        }
    }
}

async function validateServiceAccountJson(serviceAccountJsonRaw: string | undefined, serviceAccountJson: string | undefined): Promise<boolean> {
    if (serviceAccountJson && serviceAccountJsonRaw) {
        // If the user provided both, print a warning one will be ignored
        core.warning('Both \'serviceAccountJsonPlainText\' and \'serviceAccountJson\' were provided! \'serviceAccountJson\' will be ignored.')
    }

    if (serviceAccountJsonRaw) {
        // If the user has provided the raw plain text, then write to file and set appropriate env variable
        const serviceAccountFile = "./serviceAccountJson.json";
        await writeFile(serviceAccountFile, serviceAccountJsonRaw, {
            encoding: 'utf8'
        });
        core.exportVariable("GOOGLE_APPLICATION_CREDENTIALS", serviceAccountFile)
        return true
    } else if (serviceAccountJson) {
        // If the user has provided the json path, then set appropriate env variable
        core.exportVariable("GOOGLE_APPLICATION_CREDENTIALS", serviceAccountJson)
        return false
    } else {
        // If the user provided neither, fail and exit
        return Promise.reject(new Error("You must provide one of 'serviceAccountJsonPlainText' or 'serviceAccountJson' to use this action"))
    }
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        const maybeResponse = (error as Error & { response?: unknown }).response
        const maybeResponseData = extractResponseDataMessage(maybeResponse)
        return maybeResponseData ? `${error.message} (${maybeResponseData})` : error.message
    }

    if (typeof error === 'string') {
        return error
    }

    if (typeof error === 'number' || typeof error === 'boolean' || error === null || error === undefined) {
        return `Unexpected action error: ${String(error)}`
    }

    try {
        return `Unexpected action error: ${JSON.stringify(error)}`
    } catch {
        return 'Unknown error occurred.'
    }
}

function extractResponseDataMessage(response: unknown): string | undefined {
    if (!response || typeof response !== 'object') return undefined
    const maybeData = (response as { data?: unknown }).data
    if (!maybeData || typeof maybeData !== 'object') return undefined
    const maybeError = (maybeData as { error?: unknown }).error
    if (!maybeError || typeof maybeError !== 'object') return undefined
    const message = (maybeError as { message?: unknown }).message
    return typeof message === 'string' && message.length > 0 ? message : undefined
}

void run();
