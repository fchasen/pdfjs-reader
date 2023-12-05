// web/struct_tree_layer_builder.js
const PDF_ROLE_TO_HTML_ROLE = {
  // Document level structure types
  Document: null, // There's a "document" role, but it doesn't make sense here.
  DocumentFragment: null,
  // Grouping level structure types
  Part: "group",
  Sect: "group", // XXX: There's a "section" role, but it's abstract.
  Div: "group",
  Aside: "note",
  NonStruct: "none",
  // Block level structure types
  P: null,
  // H<n>,
  H: "heading",
  Title: null,
  FENote: "note",
  // Sub-block level structure type
  Sub: "group",
  // General inline level structure types
  Lbl: null,
  Span: null,
  Em: null,
  Strong: null,
  Link: "link",
  Annot: "note",
  Form: "form",
  // Ruby and Warichu structure types
  Ruby: null,
  RB: null,
  RT: null,
  RP: null,
  Warichu: null,
  WT: null,
  WP: null,
  // List standard structure types
  L: "list",
  LI: "listitem",
  LBody: null,
  // Table standard structure types
  Table: "table",
  TR: "row",
  TH: "columnheader",
  TD: "cell",
  THead: "columnheader",
  TBody: null,
  TFoot: null,
  // Standard structure type Caption
  Caption: null,
  // Standard structure type Figure
  Figure: "figure",
  // Standard structure type Formula
  Formula: null,
  // standard structure type Artifact
  Artifact: null,
};

const HEADING_PATTERN = /^H(\d+)$/;

class PDFTaggedViewer {
  constructor(pdfDocument, options) {
    this.pdfDocument = pdfDocument;
    this.textContentByID = {};
    this.images = {};

    this.pageCount = 0;
    this.imageCount = 1;
  }

  async render(container, start=1, end) {
    const pages = end || this.pdfDocument.numPages;
    for(let page = start; page <= pages; page++) {
      await this.addPage(page, container);
    }
  }

  async addPage(num, container) {
    const page = await this.pdfDocument.getPage(num);

    const structTree = await page.getStructTree();
    const textContent = await page.getTextContent({
      disableCombineTextItems: true,
      includeMarkedContent: true
    });

    // get images
    const images = await this.getImages(page, this.images);

    // building HTML and adding that to the DOM
    const html = this.buildHTML(textContent, structTree);

    // add page content
    const pgWrapper = document.createElement("div");
    pgWrapper.dataset.pageNumber = num;
    pgWrapper.appendChild(html);
    container.append(pgWrapper);

    // Release page resources.
    page.cleanup();
    this.pageCount++;
  }

  async getImages(page) {
    const ops = await page.getOperatorList();

    let imgObjs = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn == pdfjsLib.OPS.paintImageXObject) {
        imgObjs.push(i);
      }
    }

    for (const imgObj of imgObjs) {
      const [objId, objWidth, objHeight] = ops.argsArray[imgObj];
      const obj = page.objs.get(objId);
      const { width, height, kind, data } = obj;
      // console.log("img", width, height, objWidth, objHeight, kind, data);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      // document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d");

      const imageData = ctx.createImageData(width, height);

      if (kind == 1) {
        const imageBytes = imageData.data;
        for (let j = 0, k = 0, jj = width * height * 4; j < jj; ) {
          k++;
          imageBytes[j++] = data[k];
          imageBytes[j++] = data[k];
          imageBytes[j++] = data[k];
          imageBytes[j++] = 255;
        }
      }

      if (kind == 2) {
        const imageBytes = imageData.data;
        for (let j = 0, k = 0, jj = width * height * 4; j < jj; ) {
          imageBytes[j++] = data[k++];
          imageBytes[j++] = data[k++];
          imageBytes[j++] = data[k++];
          imageBytes[j++] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0, 0, 0, width, height);
      // console.log("got img", objId);
      this.images[objId] = canvas.toDataURL();
    }

    return this.images;
  }

  buildHTML(textContent, structTree) {
    this.imageCount = 1;
    // processing all items
    let start = false;
    let tag = false;
    textContent.items.forEach((textItem) => {
      if (textItem.type == "endMarkedContent") {
        start = false;
        tag = false;
      }
  
      if (start) {
        if (!this.textContentByID[start]) {
          this.textContentByID[start] = {
            str: textItem.str,
            tag: tag,
          }
        } else {
          this.textContentByID[start].str += textItem.str;
        }
      }
  
      if (textItem.id) {
        start = textItem.id;
        tag = textItem.tag
      }
    });
  
    let doc = document.createDocumentFragment();
    if (structTree) {
      this.processTreeItem(structTree, doc);
    }
    return doc;
  }

  processTreeItem(item, ancestor) {
    let parent = ancestor;
    // console.log("item", item);
    if (item.role) {
      switch (item.role) {
        case "Root":
          break;
        case "Document":
          parent = ancestor;
          break;
        case "TOC":
          let ol = document.createElement("ol");
          ancestor.appendChild(ol);
          parent = ol;
          break;
        case "TOCI":
          let li = document.createElement("li");
          ancestor.appendChild(li);
          parent = li;
          break;
        case "Link":
          let a = document.createElement("a");
          ancestor.appendChild(a);
          parent = a;
          break;
        case "Sect":
          let section = document.createElement("section");
          ancestor.appendChild(section);
          parent = section;
          break;
        case "Figure":
          let figure = document.createElement("figure");
          let img = document.createElement("img");
          console.log(`img_p${this.pageCount}_${this.imageCount}`);
          img.src = this.images[`img_p${this.pageCount}_${this.imageCount}`];
          figure.appendChild(img);

          if (item.alt) {
            img.alt = item.alt;
            let caption = document.createElement("figcaption");
            caption.textContent = item.alt;
            figure.appendChild(caption);
          }
          ancestor.appendChild(figure);
          parent = figure;
          this.imageCount++;
          break;
        case "Lbl":
          // skip
          return;
        case "LBody":
          // only content
          break;
        default:
          let s = document.createElement(item.role);
          ancestor.appendChild(s);
          parent = s;
          break;
      }
    }

    switch (item.type) {
      case "content":
        let text = this.textContentByID[item.id];
        if (text) {
          if(text.str) ancestor.textContent += text.str;
        } else {
          // console.log("Missed", item);
        }
        break;
      case "object":
        let object = item.id;
        // console.log("object", object);
        break;
      default:
        break;
    }
  
    if (item.children) {
      for (const kid of item.children) {
        this.processTreeItem(kid, parent);
      }
    }
  }
}

export default PDFTaggedViewer;