import PDFTaggedViewer from "./taggedviewer.js";

const DEFAULT_PDF_PATH = "tagged.pdf";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "./node_modules/pdfjs-dist/build/pdf.worker.js";

function taggedError(container) {
  const pgWrapper = document.createElement("h1");
  pgWrapper.textContent = "Not a Tagged PDF."
  container.append(pgWrapper);
  loaded();
}

function loaded() {
  document.querySelector("body").classList.add("loaded");
}

async function pageLoaded() {
  const container = document.querySelector("#pageContainer");
  const input = document.querySelector("#pdf-upload");

  const params = new URLSearchParams(document.location.search);
  const pdfUrl = params.get("url");

  let pdf;
  if (pdfUrl) {
    pdf = { url: pdfUrl };
  } else {
    pdf = await waitForUpload(input);
  }

  input.style.display = "none";
  const loadingTask = pdfjsLib.getDocument(pdf);

  const pdfDocument = await loadingTask.promise;

  const page = await pdfDocument.getPage(1);
  const structTree = await page.getStructTree();
  if (!structTree) {
    taggedError(container);
    return;
  }

  let reader = new PDFTaggedViewer(pdfDocument);
  await reader.render(container);

  loaded();
}

async function waitForUpload(inputElement) {
  return new Promise((resolve) => {
    inputElement.onchange = function(event) {
      const file = event.target.files[0];
      const fileReader = new FileReader();

      fileReader.onload = function() {
          const typedArray = new Uint8Array(this.result);
          resolve(typedArray);
      };
      fileReader.readAsArrayBuffer(file);
   }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  if (typeof pdfjsLib === "undefined") {
    // eslint-disable-next-line no-alert
    alert("Please build the pdfjs-dist library using\n  `gulp dist-install`");
    return;
  }
  pageLoaded();
});
