```json
{
  "tag": "html",
  "customElement": {
    "enable": true,
    "name": "not-found",
    "useShadowDOM": true,
    "shadowDOMMode": "open"
  },
  "className": "not-found",
  "on": {
    "click": "@goHome"
  },
  "css": {
    "*": {
      "box-sizing": "border-box"
    },
    "*:after": {
      "box-sizing": "border-box"
    },
    "*:before": {
      "box-sizing": "border-box"
    },
    "html.not-found": {
      "background": " #1a1a1a",
      "font-family": "Arial, 'Helvetica Neue', Helvetica, sans-serif",
      "overflow": "hidden",
      "color": "#1a1a1a",
      "cursor": "pointer",
      "height": "100vh"
    },
    "html.not-found:after, html.not-found:before": {
      "content": "'404'",
      "position": "absolute",
      "font-size": "100px",
      "left": 0,
      "right": 0,
      "text-align": "center",
      "bottom": "340px",
      "font-weight": 600,
      "z-index": 200
    },
    "html.not-found:before": {
      "content": "'Page Not Found'",
      "font-size": "22px",
      "font-weight": 400,
      "bottom": "330px"
    },
    "html.not-found head": {
      "display": "block",
      "width": "35px",
      "height": "140px",
      "background": "#646464",
      "border-bottom": "10px solid #333",
      "margin": "auto",
      "transform-origin": "50% 100%",
      "-webkit-animation": "5s find linear infinite",
      "animation": "5s find linear infinite",
      "border-bottom-left-radius": "4px",
      "border-bottom-right-radius": "4px",
      "position": "absolute",
      "left": 0,
      "right": 0,
      "bottom": "-5px"
    },
    "html.not-found head:after": {
      "content": "''",
      "position": "absolute",
      "border-style": "solid",
      "border-width": "25px 25px 0 25px",
      "border-color": "#333 transparent transparent transparent",
      "width": "85px",
      "left": "-25px",
      "top": 0,
      "box-shadow": "0px -10px 0 #feaf33"
    },
    "html.not-found head:before": {
      "content": "''",
      "position": "absolute",
      "width": "8px",
      "height": "15px",
      "background": "#feaf33",
      "left": 0,
      "right": 0,
      "margin": "auto",
      "top": "40px",
      "border-radius": "6px",
      "box-shadow": "0px 0 1px 2px #333"
    },

    "html.not-found meta": {
      "display": "block",
      "width": "250px",
      "height": "200px",
      "background": "#fffee2",
      "border-radius": "50%",
      "position": "absolute",
      "left": "-107px",
      "bottom": "270px",
      "margin": "auto",
      "text-align": "center",
      "color": "#333",
      "font-size": "90px",
      "line-height": "200px",
      "font-weight": 600
    },
    "html.not-found meta:after": {
      "content": "",
      "position": "absolute",
      "border-style": "solid",
      "border-width": "190px 75px 0 75px",
      "border-color": "rgba(255, 254, 226, 0.3) transparent transparent transparent",
      "width": "230px",
      "left": "10px",
      "top": "100%",
      "transform": "translateY(-60px)"
    },
    "@-webkit-keyframes find": {
      "25%": {
        "transform": "rotate(25deg)"
      },
      "0%, 50%, 100%": {
        "transform": "rotate(0deg)"
      },
      "75%": {
        "transform": "rotate(-25deg)"
      }
    },
    "@keyframes find": {
      "25%": {
        "transform": "rotate(25deg)"
      },
      "0%,50%,100%": {
        "transform": "rotate(0deg)"
      },
      "75%": {
        "transform": "rotate(-25deg)"
      }
    }
  },
  "children": [
    {
      "tag": "head",
      "children": [
        {
          "tag": "meta",
          "attrs": {
            "charset": "UTF-8"
          }
        }
      ]
    },
    {
      "tag": "body"
    }
  ],
  "mounted": "@mounted"
}
```

```ts
import { useRouter } from "@domily/router";

const router = useRouter();
const goHome = () => {
  router.replace("/");
};

const mounted = () => {
  document.querySelector('#global-loading')?.remove()
}
```

```css
html {
  overflow: hidden;
}
```
