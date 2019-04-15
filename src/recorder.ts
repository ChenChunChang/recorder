// var lamejs = require("lamejs");
import lamejs from 'lamejs';

declare var window: any;
declare var Math: any;
declare var document: any;

// 构造函数参数格式
interface recorderConfig {
    sampleBits?: number,         // 采样位数
    sampleRate?: number,         // 采样率
    numChannels?: number,        // 声道数
}

interface dataview {
    byteLength: number,
    buffer: {
        byteLength: number,
    },
    getUint8: any,
}

class Recorder {
    private isrecording: boolean;           // 是否正在录音
    private context: any;
    private config: recorderConfig;
    private size: number;                   // 录音文件总长度
    private buffer: Array<Float32Array>;    // pcm音频数据搜集器
    private PCMData: any;                   // 存放解析完成的pcm数据
    private audioInput: any;
    private inputSampleRate: number;        // 输入采样率
    private source: any;                    // 音频输入
    private recorder: any;
    private inputSampleBits: number;        // 输入采样位数
    private outputSampleRate: number;       // 输出采样率
    private oututSampleBits: number;        // 输出采样位数

    public duration:number;                 // 录音时长
    /**
     * @param {Object} options 包含以下三个参数：
     * sampleBits，采样位数，一般8,16，默认16
     * sampleRate，采样率，一般 11025、16000、22050、24000、44100、48000，默认为浏览器自带的采样率
     * numChannels，声道，1或2
     */
    constructor(options: recorderConfig = {}) {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.inputSampleRate = this.context.sampleRate;     // 获取当前输入的采样率

        // 配置config，检查值是否有问题
        this.config = {
            // 采样数位 8, 16
            sampleBits: ~[8, 16].indexOf(options.sampleBits) ? options.sampleBits : 16,
            // 采样率
            sampleRate: ~[11025, 16000, 22050, 24000, 44100, 48000].indexOf(options.sampleRate) ? options.sampleRate : this.inputSampleRate,
            // 声道数，1或2
            numChannels: ~[1, 2].indexOf(options.numChannels) ? options.numChannels : 1,
        };
        this.size = 0;              // 录音文件总长度
        this.buffer = [];           // 录音缓存
        this.PCMData = null;        // 存储转换后的pcm数据
        this.audioInput = null;     // 录音输入节点

        // 第一个参数表示收集采样的大小，采集完这么多后会触发 onaudioprocess 接口一次，该值一般为1024,2048,4096等，一般就设置为4096
        // 第二，三个参数分别是输入的声道数和输出的声道数，保持一致即可。
        let createScript = this.context.createScriptProcessor || this.context.createJavaScriptNode;
        this.recorder = createScript.apply(this.context, [4096, this.config.numChannels, this.config.numChannels]);

        // 音频采集
        this.recorder.onaudioprocess = e => {
            // getChannelData返回Float32Array类型的pcm数据
            if (1 === this.config.numChannels) {
                let data = e.inputBuffer.getChannelData(0);
                // 单通道
                this.buffer.push(new Float32Array(data));
                this.size += data.length;
            } else {
                /*
                 * 双声道处理
                 * e.inputBuffer.getChannelData(0)得到了左声道4096个样本数据，1是右声道的数据，
                 * 此处需要组和成LRLRLR这种格式，才能正常播放，所以要处理下
                 */
                let lData = new Float32Array(e.inputBuffer.getChannelData(0)),
                    rData = new Float32Array(e.inputBuffer.getChannelData(1)),
                    // 新的数据为左声道和右声道数据量之和
                    buffer = new ArrayBuffer(lData.byteLength + rData.byteLength),
                    dData = new Float32Array(buffer),
                    offset = 0;

                for (let i = 0; i < lData.byteLength; ++i) {
                    dData[ offset ] = lData[i];
                    offset++;
                    dData[ offset ] = rData[i];
                    offset++;
                }

                this.buffer.push(dData);
                this.size += offset;
            }
            // 统计录音时长
            this.duration += 4096 / this.inputSampleRate;
        }
    }

    // 开始录音
    start() {
        if (this.isrecording) {
            // 正在录音，则不允许
            return;
        }
        // 清空数据
        this.clear();
        this.isrecording = true;

        navigator.mediaDevices.getUserMedia({
            audio: true
        }).then(stream => {
            // audioInput表示音频源节点
            // stream是通过navigator.getUserMedia获取的外部（如麦克风）stream音频输出，对于这就是输入
            this.audioInput = this.context.createMediaStreamSource(stream);
        }, error => {
            // 抛出异常
            Recorder.throwError(error.name + " : " + error.message);
        }).then(() => {
            // audioInput 为声音源，连接到处理节点 recorder
            this.audioInput.connect(this.recorder);
            // 处理节点 recorder 连接到扬声器
            this.recorder.connect(this.context.destination);
            // 设置压缩参数
            this.inputSampleBits = 16;                          // 输入采样数位 8, 16
            this.outputSampleRate = this.config.sampleRate;     // 输出采样率
            this.oututSampleBits = this.config.sampleBits;      // 输出采样数位 8, 16
        });
    }
    
    // 暂停录音
    pause(): void {
        this.audioInput && this.audioInput.disconnect();
        this.recorder.disconnect();
    }

    // 继续录音
    resume(): void {
        this.audioInput && this.audioInput.connect(this.recorder);
        // 处理节点 recorder 连接到扬声器
        this.recorder.connect(this.context.destination);
    }

    // 停止录音
    stop(): void {
        this.isrecording = false;
        this.audioInput && this.audioInput.disconnect();
        this.recorder.disconnect();
    }

    // 播放声音
    play(): void {
        this.stop();
        // 关闭前一次音频播放
        this.source.stop();

        this.context.decodeAudioData(this.getWAV().buffer, buffer => {
            this.source = this.context.createBufferSource();

            // 设置数据
            this.source.buffer = buffer;
            // connect到扬声器
            this.source.connect(this.context.destination);
            this.source.start();
        }, function(e) {
            Recorder.throwError(e);
        });
    }

    // 获取PCM编码的二进制数据
    getPCM() {
        // 有pcm数据时，则直接使用缓存
        if (!this.PCMData) {
            // 二维转一维
            let data = this.flat();
            // 压缩或扩展
            data = Recorder.compress(data, this.inputSampleRate, this.outputSampleRate);
            // 按采样位数重新编码
            this.PCMData = Recorder.encodePCM(data, this.oututSampleBits);
        }

        return this.PCMData;
    }

    // 获取不压缩的PCM格式的编码
    getPCMBlob() {
        return new Blob([ this.getPCM() ]);
    }

    // 下载录音的pcm数据
    downloadPCM() {
        // 先停止
        this.stop();
        let pcmBlob = this.getPCMBlob();
        
        this.download(pcmBlob, 'recorder', 'pcm');
    }

    // 获取WAV编码的二进制数据
    getWAV() {
        let pcmTemp = this.getPCM(),
            wavTemp = Recorder.encodeWAV(pcmTemp, this.inputSampleRate, this.outputSampleRate, this.config.numChannels, this.oututSampleBits);

        return wavTemp;
    }

    // 获取不压缩的WAV格式的编码
    getWAVBlob() {
        return new Blob([ this.getWAV() ], { type: 'audio/wav' });
    }

    // 下载录音的wav数据
    downloadWAV() {
        // 先停止
        this.stop();
        let wavBlob = this.getWAVBlob();
        
        this.download(wavBlob, 'recorder', 'wav');
    }

    // 获取MP3格式的二进制数据
    getMP3() {
        // 先停止
        this.stop();
        let wavTemp = this.getWAV();

        return Recorder.encodePM3(wavTemp);
    }

    // 获取MP3格式的blob数据
    getMP3Blob() {
        return new Blob(this.getMP3(), {type: 'audio/mp3'});
    }

    /**
     * 销毁录音对象
     * @param {*} fn        回调函数
     * @memberof Recorder
     */
    destroy(fn) {
        this.context.close().then(() => {
            fn.call(this);
        });
    }

    /**
     * 下载录音文件
     * @private
     * @param {*} blob      blob数据
     * @param {string} name 下载的文件名
     * @param {string} type 下载的文件后缀
     * @memberof Recorder
     */
    private download(blob, name: string, type: string): void {
        try {
            let oA = document.createElement('a');
            
            oA.href = window.URL.createObjectURL(blob);
            oA.download = name + '.' + type;
            oA.click();
        } catch(e) {
            Recorder.throwError(e);
        }
    }

    // 清空
    private clear(): void {
        this.buffer.length = 0;
        this.size = 0;
        this.PCMData = null;
        this.audioInput = null;
        this.duration = 0;

        // 录音前，关闭录音播放
        this.source && this.source.stop();
    }

    // 将二维数组转一维
    private flat() {
        // 合并
        let data = new Float32Array(this.size),
            offset = 0; // 偏移量计算

        // 将二维数据，转成一维数据
        for (let i = 0; i < this.buffer.length; i++) {
            data.set(this.buffer[i], offset);
            offset += this.buffer[i].length;
        }

        return data;
    }

    // 数据合并压缩
    // 根据输入和输出的采样率压缩数据，
    // 比如输入的采样率是48k的，我们需要的是（输出）的是16k的，由于48k与16k是3倍关系，
    // 所以输入数据中每隔3取1位
    static compress(data, inputSampleRate, outputSampleRate) {
        // 压缩，根据采样率进行压缩
        let compression = Math.max(Math.floor(inputSampleRate / outputSampleRate), 1),
            length = data.length / compression,
            result = new Float32Array(length),
            index = 0, j = 0;

        // 循环间隔 compression 位取一位数据
        while (index < length) {
            result[index] = data[j];
            j += compression;
            index++;
        }
        // 返回压缩后的一维数据
        return result;
    }

    /**
     * 转换到我们需要的对应格式的编码
     * return {DataView}    pcm编码的数据
     */
    static encodePCM(bytes, sampleBits: number): dataview {
        let offset = 0,
            dataLength = bytes.length * (sampleBits / 8),
            buffer = new ArrayBuffer(dataLength),
            data = new DataView(buffer);
    
        // 写入采样数据
        if (sampleBits === 8) {
            for (var i = 0; i < bytes.length; i++, offset++) {
                // 范围[-1, 1]
                var s = Math.max(-1, Math.min(1, bytes[i]));
                // 8位采样位划分成2^8=256份，它的范围是0-255; 
                // 对于8位的话，负数*128，正数*127，然后整体向上平移128(+128)，即可得到[0,255]范围的数据。
                var val = s < 0 ? s * 128 : s * 127;
                val = +val + 128;
                data.setInt8(offset, val);
            }
        } else {
            for (var i = 0; i < bytes.length; i++, offset += 2) {
                var s = Math.max(-1, Math.min(1, bytes[i]));
                // 16位的划分的是2^16=65536份，范围是-32768到32767
                // 因为我们收集的数据范围在[-1,1]，那么你想转换成16位的话，只需要对负数*32768,对正数*32767,即可得到范围在[-32768,32767]的数据。
                data.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }
        }
    
        return data;
    }

    /**
     * 编码wav，一般wav格式是在pcm文件前增加44个字节的文件头，
     * 所以，此处只需要在pcm数据前增加下就行了。
     * @static
     * @param {DataView} bytes           pcm二进制数据
     * @param {Number} inputSampleRate   输入采样率
     * @param {Number} outputSampleRate  输出采样率
     * @param {Number} numChannels       声道数
     * @param {Number} oututSampleBits   输出采样位数
     * @returns {DataView}               wav二进制数据
     * @memberof Recorder
     */
    static encodeWAV(bytes: dataview, inputSampleRate: number, outputSampleRate: number, numChannels: number, oututSampleBits: number) {
        let sampleRate = Math.min(inputSampleRate, outputSampleRate),
            sampleBits = oututSampleBits,
            buffer = new ArrayBuffer(44 + bytes.byteLength),
            data = new DataView(buffer),
            channelCount = numChannels, // 声道
            offset = 0;
    
        // 资源交换文件标识符
        writeString(data, offset, 'RIFF'); offset += 4;
        // 下个地址开始到文件尾总字节数,即文件大小-8
        data.setUint32(offset, 36 + bytes.byteLength, true); offset += 4;
        // WAV文件标志
        writeString(data, offset, 'WAVE'); offset += 4;
        // 波形格式标志
        writeString(data, offset, 'fmt '); offset += 4;
        // 过滤字节,一般为 0x10 = 16
        data.setUint32(offset, 16, true); offset += 4;
        // 格式类别 (PCM形式采样数据)
        data.setUint16(offset, 1, true); offset += 2;
        // 声道数
        data.setUint16(offset, channelCount, true); offset += 2;
        // 采样率,每秒样本数,表示每个通道的播放速度
        data.setUint32(offset, sampleRate, true); offset += 4;
        // 波形数据传输率 (每秒平均字节数) 声道数 × 采样频率 × 采样位数 / 8
        data.setUint32(offset, channelCount * sampleRate * (sampleBits / 8), true); offset += 4;
        // 快数据调整数 采样一次占用字节数 声道数 × 采样位数 / 8
        data.setUint16(offset, channelCount * (sampleBits / 8), true); offset += 2;
        // 采样位数
        data.setUint16(offset, sampleBits, true); offset += 2;
        // 数据标识符
        writeString(data, offset, 'data'); offset += 4;
        // 采样数据总数,即数据总大小-44
        data.setUint32(offset, bytes.byteLength, true); offset += 4;
        
        // 给wav头增加pcm体
        for (let i = 0; i < bytes.byteLength;) {
            data.setUint8(offset, bytes.getUint8(i));
            offset++;
            i++;
        }
    
        return data;
    }

    // 利用lamejs将wav转化成mp3格式
    static encodePM3(wavData) {
        let wavHeader = lamejs.WavHeader.readHeader(new DataView(wavData)),
            samples = new Int16Array(wavData, wavHeader.dataOffset, wavHeader.dataLen / 2),
            buffer = [],
            mp3enc = new lamejs.Mp3Encoder(wavHeader.channels, wavHeader.sampleRate, 128),
            remaining = samples.length,
            maxSamples = 1152;

        for (let i = 0; remaining >= maxSamples; i += maxSamples) {
            let mono = samples.subarray(i, i + maxSamples);
            let mp3buf = mp3enc.encodeBuffer(mono);
            if (mp3buf.length > 0) {
                buffer.push(new Int8Array(mp3buf));
            }
            remaining -= maxSamples;
        }
        let mp3buf = mp3enc.flush();
        if (mp3buf.length > 0) {
            buffer.push(new Int8Array(mp3buf));
        }

        return buffer;
    }

    // 异常处理
    static throwError(message) {
        throw new Error (message);
    }
}

/**
 * 在data中的offset位置开始写入str字符串
 * @param {TypedArrays} data 二进制数据
 * @param {String}      str  字符串
 */
function writeString(data, offset, str) {
    for (var i = 0; i < str.length; i++) {
        data.setUint8(offset + i, str.charCodeAt(i));
    }
}

export default Recorder;
