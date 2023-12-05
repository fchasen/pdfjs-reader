class PDFTaggedViewer {
  constructor(pdfDocument, options={}) {
    this.pdfDocument = pdfDocument;
    this.textContentByID = {};
    this.images = {};

    this.pageCount = 0;
    this.imageCount = 1;

    this.pdfjsLib = options.pdfjsLib || window.pdfjsLib;
    this.doc = options.doc || document;
  }

  async render(container, start = 1, end) {
    const pages = end || this.pdfDocument.numPages;
    const page = await this.pdfDocument.getPage(start);
    const structTree = await page.getStructTree();
    if (!structTree) {
      return;
    }
    await this.addMetadata();
    for (let page = start; page <= pages; page++) {
      await this.addPage(page, container);
    }
  }

  async addMetadata() {
    const { info } = await this.pdfDocument.getMetadata();
    console.log(info);
    const head = document.querySelector("head");

    if (info["Author"]) {
      let author = document.createElement("meta");
      author.name = "dc:creator";
      author.content = info["Author"];
      head.appendChild(author);
    }

    if (info["Subject"]) {
      let subject = document.createElement("meta");
      subject.name = "dc:subject";
      subject.content = info["Subject"];
      head.appendChild(subject);
    }

    if (info["Keywords"]) {
      let keywords = document.createElement("meta");
      keywords.name = "dc:keywords";
      keywords.content = info["Keywords"];
      head.appendChild(keywords);
    }

    if (info["Title"]) {
      let title = document.createElement("meta");
      title.name = "dc:title";
      title.content = info["Title"];
      head.appendChild(title);
    }

  }

  async addPage(num, container) {
    const page = await this.pdfDocument.getPage(num);
    const structTree = await page.getStructTree();
    const textContent = await page.getTextContent({
      disableCombineTextItems: true,
      includeMarkedContent: true,
    });

    // get images
    const images = await this.getImages(page, this.images);

    // building HTML and adding that to the DOM
    const html = this.buildHTML(textContent, structTree);

    // add page content
    const pgWrapper = this.doc.createElement("div");
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
      if (fn == this.pdfjsLib.OPS.paintImageXObject) {
        imgObjs.push(i);
      }
    }

    for (const imgObj of imgObjs) {
      const [objId] = ops.argsArray[imgObj];
      const obj = page.objs.get(objId);
      const { width, height, kind, data } = obj;

      let canvas = this.doc.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      let ctx = canvas.getContext("2d");

      const imageData = ctx.createImageData(width, height);
      let imageBytes = imageData.data;

      if (kind == 1) {
        for (let j = 0, k = 0, jj = width * height * 4; j < jj; ) {
          k++;
          imageBytes[j++] = data[k];
          imageBytes[j++] = data[k];
          imageBytes[j++] = data[k];
          imageBytes[j++] = 255;
        }
      }

      if (kind == 2) {
        for (let j = 0, k = 0, jj = width * height * 4; j < jj; ) {
          imageBytes[j++] = data[k++];
          imageBytes[j++] = data[k++];
          imageBytes[j++] = data[k++];
          imageBytes[j++] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      this.images[objId] = canvas.toDataURL("image/jpeg");
      canvas = undefined;
      ctx = undefined;
    }
    return this.images;
  }

  buildHTML(textContent, structTree) {
    // processing all items
    let start = false;
    let tag = false;

    // reset images count
    this.imageCount = 1;

    textContent.items.forEach(textItem => {
      if (textItem.type == "endMarkedContent") {
        start = false;
        tag = false;
      }

      if (start) {
        if (!this.textContentByID[start]) {
          this.textContentByID[start] = {
            str: textItem.str,
            tag: tag,
          };
        } else {
          this.textContentByID[start].str += textItem.str;
        }
      }

      if (textItem.id) {
        start = textItem.id;
        tag = textItem.tag;
      }
    });

    let doc = this.doc.createDocumentFragment();
    if (structTree) {
      this.processTreeItem(structTree, doc);
    }
    return doc;
  }

  processTreeItem(item, ancestor) {
    let parent = ancestor;
    if (item.role) {
      switch (item.role) {
        case "Root":
          break;
        case "Document":
          parent = ancestor;
          break;
        case "TOC":
          let ol = this.doc.createElement("ol");
          ancestor.appendChild(ol);
          parent = ol;
          break;
        case "TOCI":
          let li = this.doc.createElement("li");
          ancestor.appendChild(li);
          parent = li;
          break;
        case "Link":
          let a = this.doc.createElement("a");
          ancestor.appendChild(a);
          parent = a;
          break;
        case "Sect":
          let section = this.doc.createElement("section");
          ancestor.appendChild(section);
          parent = section;
          break;
        case "Figure":
          let figure = this.doc.createElement("figure");
          let img = this.doc.createElement("img");
          img.src = this.images[`img_p${this.pageCount}_${this.imageCount}`];
          figure.appendChild(img);

          if (item.alt) {
            img.alt = item.alt;
            let caption = this.doc.createElement("figcaption");
            caption.textContent = item.alt;
            figure.appendChild(caption);
          }
          ancestor.appendChild(figure);
          parent = figure;
          this.imageCount++;
          break;
        case "FENote":
        case "Annot":
          let note = this.doc.createElement("note");
          ancestor.appendChild(note);
          parent = note;
          break;
        case "Formula":
          let pre = this.doc.createElement("pre");
          ancestor.appendChild(pre);
          parent = pre;
          break;
        case "Lbl":
          // skip
          return;
        case "LBody":
        case "Part":
        case "NonStruct":
        case "Sub":
        case "Artifact":
          // only content
          break;
        case "Warichu":
        case "WT":
        case "WP":
          // unsupported
          break;
        default:
          let s = this.doc.createElement(item.role);
          ancestor.appendChild(s);
          parent = s;
          break;
      }
    }

    switch (item.type) {
      case "content":
        let text = this.textContentByID[item.id];
        if (text) {
          if (text.str) ancestor.textContent += text.str;
        } else {
          console.log("Missed", item);
        }
        break;
      case "object":
        let object = item.id;
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

// export default PDFTaggedViewer;
window.PDFTaggedViewer = PDFTaggedViewer;