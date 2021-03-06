import Breadcrumb from '../../../components/breadcrumb';
import BaseInteraction from '../../../interaction/base';
import { BBox, Group, Rect } from '@antv/g';
import Sunburst from '../layer';
import { each, hasKey, isFunction, clone, isString } from '@antv/util';
import { View } from '@antv/g2';

const DEFAULT_ITEM_WIDTH = 100;
const DEFAULT_ITEM_HEIGHT = 30;
const PADDING_TOP = 10;

interface IStartNode {
  name?: string;
}

interface IMapping {
  [key: string]: IMappingConfig;
}

interface IMappingConfig {
  field: string;
  values?: string[] | string;
}

interface IDrillDownInteractionConfig {
  x?: number;
  y?: number;
  startNode?: IStartNode;
  itemWidth?: number;
  itemHeight?: number;
  padding?: number[];
  [key: string]: any;
}

const getValidBreadcrumbConfig = (cfg: IDrillDownInteractionConfig = {}): Required<IDrillDownInteractionConfig> => {
  const _cfg: Required<IDrillDownInteractionConfig> = {
    x: 0,
    y: 0,
    startNode: { name: 'root' },
    itemWidth: DEFAULT_ITEM_WIDTH,
    itemHeight: DEFAULT_ITEM_HEIGHT,
    padding: [0, 0, 0, 0],
    ...cfg,
  };
  return _cfg;
};

export default class DrillDownInteraction extends BaseInteraction {
  public static getInteractionRange(layerRange: BBox, interaction: IDrillDownInteractionConfig) {
    const config: Required<IDrillDownInteractionConfig> = getValidBreadcrumbConfig(interaction);
    const [paddingTop, paddingBottom] = config.padding;
    return new BBox(
      layerRange.minX,
      layerRange.maxY - config.itemHeight - paddingTop - paddingBottom,
      layerRange.width,
      config.itemHeight + paddingTop + paddingBottom
    );
  }

  public view: View;
  private container: Group;
  private breadcrumb: Breadcrumb;
  private plot: Sunburst;
  private startNode: IStartNode;
  private parentNode: any;
  private currentNode: any;
  private currentDepth: number;
  private startNodeName: string;
  private cache: any;
  private mapping: IMapping;
  private originMapping: IMappingConfig;
  private y: number;
  private geometry: any;

  public start(ev) {
    const data = ev.data._origin;
    if (data.children) {
      this.parentNode = {
        shape: ev.target,
        data: {
          name: clone(this.currentNode.name),
          value: clone(this.currentNode.value),
        },
        depth: clone(this.currentDepth),
      };
      this.currentDepth++;
      //drillingDown(ev.target, this.view, () => {
      this.update(data);
      //});
    }
  }

  protected update(data) {
    if (!hasKey(this.cache, data.name)) {
      this.cache[data.name] = data;
    }
    const tempoData = this.plot.getSunburstData(data, this.plot.options.maxLevel);
    this.view.changeData(tempoData);
    this.currentNode = data;
    this.render();
  }

  protected render() {
    if (this.breadcrumb) {
      const items = this.getItems();
      this.breadcrumb.update({
        items,
      });
      this.layout();
    } else {
      this.initGeometry();
      this.cache = {};
      this.saveOriginMapping();
      this.container = this.container = this.plot.canvas.addGroup();
      if (!this.startNode) {
        this.startNode = {
          name: 'root',
        };
      }
      if (this.startNode.name === 'root') {
        this.startNodeName = hasKey(this.plot.options.data, 'name') ? this.plot.options.data.name : 'root';
        this.currentNode = this.plot.options.data;
        this.currentDepth = 1;
      } else {
        this.startNodeName = this.startNode.name;
        this.currentNode = this.startNode;
      }
      this.y = this.view.get('viewRange').maxY + PADDING_TOP;
      this.breadcrumb = new Breadcrumb({
        container: this.container,
        x: 0,
        y: this.y,
        items: this.getItems(),
      });
      this.breadcrumb.render();
      this.layout();
    }
    this.onInteraction();
  }

  protected clear() {}

  private layout() {
    const currentWidth = this.container.getBBox().width;
    const x = (this.plot.width - currentWidth) / 2;
    this.breadcrumb.update({
      x,
      y: this.y,
    });
  }

  private getItems() {
    let items = [];
    if (this.currentNode.name && this.currentNode.name === this.startNodeName) {
      const rootItem = this.getRootItem();
      items.push(rootItem);
    } else {
      items = [];
      const parents = [];
      this.findParent(this.currentNode, parents);
      parents.reverse();
      //items.push(this.getRootItem());
      each(parents, (p, index) => {
        items.push({ key: String(index + 1), text: p.name, data: p });
      });
      items.push({ key: String(parents.length + 2), text: this.currentNode.name, data: this.currentNode });
    }
    return items;
  }

  private findParent(data, parents) {
    if (data.parent) {
      if (hasKey(this.cache, data.parent.name)) {
        parents.push(this.cache[data.parent.name]);
      } else {
        parents.push(data.parent);
      }
      this.findParent(data.parent, parents);
    } else {
      return;
    }
  }

  private onInteraction() {
    this.container.on('click', (ev) => {
      const targetParent = ev.target.get('parent');
      if (targetParent && targetParent.get('class') === 'item-group') {
        const data = targetParent.get('data');
        if (data.data) {
          if (data.text === this.startNodeName) {
            const targetDepth = 1;
            //只有前后depth相邻才执行上卷动画，否则直接更新
            if (this.currentDepth - 1 === targetDepth) {
              //rollingUp(this.currentNode.name, this.view, () => {
              this.updateRoot(data);
              //});
            } else {
              this.updateRoot(data);
            }
            this.currentDepth = 1;
          } else if (this.currentNode === data.data) {
            return;
          } else {
            const previousDepth = clone(this.currentDepth);
            this.currentDepth = parseInt(data.key);
            if (previousDepth - 1 === this.currentDepth) {
              //rollingUp(this.currentNode.name, this.view, () => {
              this.update(data.data);
              //});
            } else {
              this.update(data.data);
            }
          }
        }
      }
    });
  }

  private getRootItem() {
    const rootData = this.plot.options.data;
    const rootName = hasKey(rootData, 'name') ? rootData.name : 'root';
    return { key: '1', text: rootName, data: this.plot.rootData };
  }

  private saveOriginMapping() {
    const { colorField, colors } = this.plot.options;
    const mappingInfo = { field: colorField, values: colors };
    this.originMapping = mappingInfo;
  }

  private initGeometry() {
    this.geometry = this.view.get('elements')[0];
    const viewRange = this.view.get('viewRange');
    const container = this.geometry.get('container');
    const cliper = new Rect({
      attrs: {
        x: viewRange.minX,
        y: viewRange.minY,
        width: viewRange.width,
        height: viewRange.height,
      },
    });
    container.attr('clip', cliper);
  }

  private updateRoot(data) {
    const tempoData = this.plot.getSunburstData(data.data, this.plot.options.maxLevel);
    this.view.changeData(tempoData);
    this.currentNode = this.plot.options.data;
    this.render();
  }
}

BaseInteraction.registerInteraction('drilldown', DrillDownInteraction);
