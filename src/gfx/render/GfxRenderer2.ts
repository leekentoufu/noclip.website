
import { GfxMegaStateDescriptor, GfxInputState, GfxDevice, GfxRenderPass, GfxRenderPipelineDescriptor, GfxPrimitiveTopology, GfxBindingLayoutDescriptor, GfxBindingsDescriptor, GfxBindings, GfxSamplerBinding, GfxProgram } from "../platform/GfxPlatform";
import { defaultMegaState, copyMegaState, setMegaStateFlags } from "../helpers/GfxMegaStateDescriptorHelpers";
import { GfxRenderCache } from "./GfxRenderCache";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { nArray, assert } from "../../util";
import { TextureMapping } from "../../TextureHolder";

// Changes to V2:
//  * RenderInst is now meant to be reconstructed every frame, even more similarly to T3.
//    GC costs are absorbed with an object pool.
//  * Because we recreate RenderInsts every single frame, instead of the heavy runtime template
//    dynamic inheritance system, we can simply demand that RenderInsts are recreated. So
//    templates become a "blueprint" rather than an actual RenderInst.

const enum GfxRenderInstFlags {
    VISIBLE = 1 << 0,
    DRAW_INDEXED = 1 << 1,
}

export class GfxRenderInst {
    public sortKey: number = 0;
    public passMask: number = 0;

    // Pipeline building.
    private _renderPipelineDescriptor: GfxRenderPipelineDescriptor;

    // Bindings building.
    private _uniformBuffer: GfxRenderDynamicUniformBuffer;
    private _bindingDescriptors: GfxBindingsDescriptor[] = nArray(1, () => ({ samplerBindings: [], uniformBufferBindings: [] } as GfxBindingsDescriptor));
    private _dynamicUniformBufferOffsets: number[] = nArray(4, () => 0);

    public _flags: number = 0;
    public _parentTemplateIndex: number = -1;
    private _inputState: GfxInputState;
    private _drawStart: number;
    private _drawCount: number;

    constructor() {
        this._renderPipelineDescriptor = {
            bindingLayouts: [],
            inputLayout: null,
            megaStateDescriptor: copyMegaState(defaultMegaState),
            program: null,
            topology: GfxPrimitiveTopology.TRIANGLES,
        };
    }

    public reset(): void {
        this.sortKey = 0;
        this.passMask = 0;
    }

    public setFromTemplate(o: GfxRenderInst): void {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, o._renderPipelineDescriptor.megaStateDescriptor);
        this._renderPipelineDescriptor.program = o._renderPipelineDescriptor.program;
        this._renderPipelineDescriptor.inputLayout = o._renderPipelineDescriptor.inputLayout;
        this._renderPipelineDescriptor.topology = o._renderPipelineDescriptor.topology;
        this._inputState = o._inputState;
        this._uniformBuffer = o._uniformBuffer;
        this._setBindingLayout(o._bindingDescriptors[0].bindingLayout);
        this.setSamplerBindings(o._bindingDescriptors[0].samplerBindings);
        for (let i = 0; i < o._bindingDescriptors[0].bindingLayout.numUniformBuffers; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].wordCount = o._bindingDescriptors[0].uniformBufferBindings[i].wordCount;
    }

    public setGfxProgram(program: GfxProgram): void {
        this._renderPipelineDescriptor.program = program;
    }

    public setMegaStateFlags(r: Partial<GfxMegaStateDescriptor>): void {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, r);
    }

    public setInputState(device: GfxDevice, inputState: GfxInputState | null): void {
        this._inputState = inputState;
        this._renderPipelineDescriptor.inputLayout = inputState !== null ? device.queryInputState(inputState).inputLayout : null;
    }

    public drawIndexes(indexCount: number, indexStart: number = 0): void {
        this._flags |= GfxRenderInstFlags.DRAW_INDEXED;
        this._drawCount = indexCount;
        this._drawStart = indexStart;
    }

    public drawPrimitives(primitiveCount: number, primitiveStart: number = 0): void {
        this._drawCount = primitiveCount;
        this._drawStart = primitiveStart;
    }

    private _setBindingLayout(bindingLayout: GfxBindingLayoutDescriptor): void {
        assert(bindingLayout.numUniformBuffers < this._dynamicUniformBufferOffsets.length);
        this._renderPipelineDescriptor.bindingLayouts[0] = bindingLayout;
        this._bindingDescriptors[0].bindingLayout = bindingLayout;

        for (let i = this._bindingDescriptors[0].uniformBufferBindings.length; i < bindingLayout.numUniformBuffers; i++)
            this._bindingDescriptors[0].uniformBufferBindings.push({ buffer: null, wordCount: 0, wordOffset: 0 });
        for (let i = this._bindingDescriptors[0].samplerBindings.length; i < bindingLayout.numSamplers; i++)
            this._bindingDescriptors[0].samplerBindings.push({ sampler: null, texture: null });
    }

    public setBindingBase(bindingLayouts: GfxBindingLayoutDescriptor[], uniformBuffer: GfxRenderDynamicUniformBuffer): void {
        assert(bindingLayouts.length <= this._bindingDescriptors.length);
        assert(bindingLayouts.length === 1);
        this._setBindingLayout(bindingLayouts[0]);
        this._uniformBuffer = uniformBuffer;
    }

    public allocateUniformBuffer(bufferIndex: number, wordCount: number): number {
        assert(this._bindingDescriptors[0].bindingLayout.numUniformBuffers < this._dynamicUniformBufferOffsets.length);
        this._dynamicUniformBufferOffsets[bufferIndex] = this._uniformBuffer.allocateChunk(wordCount);

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordOffset = 0;
        dst.wordCount = wordCount;
        return this._dynamicUniformBufferOffsets[bufferIndex];
    }

    public mapUniformBufferF32(bufferIndex: number): Float32Array {
        return this._uniformBuffer.mapBufferF32(this._dynamicUniformBufferOffsets[bufferIndex], this._bindingDescriptors[0].uniformBufferBindings[bufferIndex].wordCount);
    }

    public copyUniformBufferBinding(bufferIndex: number, src: GfxRenderInst): void {
        assert(this._bindingDescriptors[0].bindingLayout.numUniformBuffers < this._dynamicUniformBufferOffsets.length);
        this._bindingDescriptors[0].uniformBufferBindings[bufferIndex].wordOffset = src._bindingDescriptors[0].uniformBufferBindings[bufferIndex].wordOffset;
    }

    public setSamplerBindings(m: GfxSamplerBinding[]): void {
        for (let i = 0; i < m.length; i++) {
            const dst = this._bindingDescriptors[0].samplerBindings[i];
            dst.texture = m[i].texture;
            dst.sampler = m[i].sampler;
        }
    }

    public setSamplerBindingsFromTextureMappings(m: TextureMapping[]): void {
        for (let i = 0; i < m.length; i++) {
            const dst = this._bindingDescriptors[0].samplerBindings[i];
            dst.texture = m[i].gfxTexture;
            dst.sampler = m[i].gfxSampler;
        }
    }

    public drawOnPass(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        const gfxPipeline = cache.createRenderPipeline(device, this._renderPipelineDescriptor);
        if (!device.queryPipelineReady(gfxPipeline))
            return;

        passRenderer.setPipeline(gfxPipeline);
        passRenderer.setInputState(this._inputState);

        for (let i = 0; i < this._bindingDescriptors[0].uniformBufferBindings.length; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].buffer = this._uniformBuffer.gfxBuffer;

        // TODO(jstpierre): Support multiple binding descriptors.
        const gfxBindings = cache.createBindings(device, this._bindingDescriptors[0]);
        passRenderer.setBindings(0, gfxBindings, this._dynamicUniformBufferOffsets);

        if ((this._flags & GfxRenderInstFlags.DRAW_INDEXED))
            passRenderer.drawIndexed(this._drawCount, this._drawStart);
        else
            passRenderer.draw(this._drawCount, this._drawStart);
    }
}

// Basic linear pool allocator.
export class GfxRenderInstPool {
    // The pool contains all render insts that we've ever created.
    public pool: GfxRenderInst[] = [];
    // The number of render insts currently allocated out to the user.
    public renderInstAllocCount: number = 0;
    // The number of render insts that we know are free, somewhere in the allocated portion of the pool.
    public renderInstFreeCount: number = 0;

    public allocRenderInstIndex(): number {
        if (this.renderInstFreeCount > 0) {
            this.renderInstFreeCount--;
            // Search for the next free render inst.
            return this.pool.findIndex((renderInst) => renderInst._flags === 0);
        }

        this.renderInstAllocCount++;

        if (this.renderInstAllocCount > this.pool.length)
            this.pool.push(new GfxRenderInst());

        return this.renderInstAllocCount - 1;
    }

    public returnRenderInst(renderInst: GfxRenderInst): void {
        renderInst._flags = 0;
        this.renderInstFreeCount++;
    }

    public reset(): void {
        for (let i = 0; i < this.renderInstAllocCount; i++)
            this.pool[i]._flags = 0;

        this.renderInstAllocCount = 0;
    }

    public destroy(): void {
        this.pool.length = 0;
        this.renderInstAllocCount = 0;
    }
}

function compareRenderInsts(a: GfxRenderInst, b: GfxRenderInst): number {
    // Force invisible items to the end of the list.
    if (!(a._flags & GfxRenderInstFlags.VISIBLE)) return 1;
    if (!(b._flags & GfxRenderInstFlags.VISIBLE)) return -1;
    return a.sortKey - b.sortKey;
}

export class GfxRenderInstManager {
    // TODO(jstpierre): Share these caches between scenes.
    public gfxRenderCache = new GfxRenderCache();
    public gfxRenderInstPool = new GfxRenderInstPool();

    public pushRenderInst(): GfxRenderInst {
        const renderInstIndex = this.gfxRenderInstPool.allocRenderInstIndex();
        const renderInst = this.gfxRenderInstPool.pool[renderInstIndex];
        if (this.renderInstTemplateIndex >= 0)
            renderInst.setFromTemplate(this.gfxRenderInstPool.pool[this.renderInstTemplateIndex]);
        else
            renderInst.reset();
        renderInst._flags = GfxRenderInstFlags.VISIBLE;
        return renderInst;
    }

    private renderInstTemplateIndex: number = -1;
    public pushTemplateRenderInst(): GfxRenderInst {
        const newTemplateIndex = this.gfxRenderInstPool.allocRenderInstIndex();
        const newTemplate = this.gfxRenderInstPool.pool[newTemplateIndex];
        if (this.renderInstTemplateIndex >= 0) {
            newTemplate.setFromTemplate(this.gfxRenderInstPool.pool[this.renderInstTemplateIndex]);
            newTemplate._parentTemplateIndex = this.renderInstTemplateIndex;
        }
        this.renderInstTemplateIndex = newTemplateIndex;
        return newTemplate;
    }

    public popTemplateRenderInst(): void {
        const renderInst = this.gfxRenderInstPool.pool[this.renderInstTemplateIndex];
        this.gfxRenderInstPool.returnRenderInst(renderInst);
        this.renderInstTemplateIndex = renderInst._parentTemplateIndex;
    }

    public executeOnPass(device: GfxDevice, passRenderer: GfxRenderPass): void {
        if (this.gfxRenderInstPool.renderInstAllocCount === 0)
            return;

        // Sort the render insts. This is guaranteed to keep unallocated render insts at the end of the list.
        this.gfxRenderInstPool.pool.sort(compareRenderInsts);

        for (let i = 0; i < this.gfxRenderInstPool.renderInstAllocCount; i++) {
            // Once we reach the first invisible item, we're done.
            if (!(this.gfxRenderInstPool.pool[i]._flags & GfxRenderInstFlags.VISIBLE))
                break;

            this.gfxRenderInstPool.pool[i].drawOnPass(device, this.gfxRenderCache, passRenderer);
        }

        // Retire the existing render insts.
        this.gfxRenderInstPool.reset();
    }

    public destroy(device: GfxDevice): void {
        this.gfxRenderInstPool.destroy();
        this.gfxRenderCache.destroy(device);
    }
}