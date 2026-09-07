export const getSupportedMimeType = () => {
    const types = ['audio/webm', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/aac', 'audio/ogg'];
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
};
