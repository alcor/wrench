chrome.commands.onCommand.addListener(runCommand);

chrome.contextMenus.onClicked.addListener((data, tab) =>  {
  runCommand(data.menuItemId, tab)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  runCommand(message.command.name, message.tab)
  sendResponse();
});



// Context Menu

function setup() {
  let manifest = chrome.runtime.getManifest();
  let commands = manifest.commands;
  for (let id in commands) {
    let c = commands[id];
    if (!c.description) continue;
    if (!c.contexts) continue;
    let description = c.description
    description = description.split(" (")[0];
    chrome.contextMenus.create({
      title: description,
      id: id,
      contexts: c.contexts
    });
  }

  restoreIcon();
}

function showSuccess() {
  chrome.action.setIcon({path: 'rsrc/checkmark_32.png'});
  setTimeout(restoreIcon, 1000);
}
function restoreIcon() {
  chrome.storage.local.get('darkmode', (value) => {
    chrome.action.setIcon({path: `rsrc/wrench${value.darkmode ? "-light" : ""}_32.png`})
  })
}


chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

let storage = chrome.storage.session || chrome.storage.local
chrome.tabs.onActivated.addListener( async info => {
  storage.get('tabHistory', value => {
    value = value.tabHistory || []
    value.unshift(info);
    storage.set({'tabHistory':value.slice(0, 10)})
  })
});

// Commands

let commandHandlers = {
  "pop-out-tab": async (tab) => {
    let window = await chrome.windows.get(tab.windowId)
    console.log("Pop out", tab, window)
    if (window.type == 'normal') {
      chrome.windows.create({
        tabId: tab.id,
        left:window.left + 52, top:window.top + 52, width:window.width - 104 , height:window.height - 104,
        type: "popup"
      });
    } else {
      //TODO: record the window the tab came from originally 
      window = (await chrome.windows.getAll({populate:false, windowTypes:['normal']}))[0]
      await chrome.tabs.move(tab.id, {windowId:window.id, index:-1})
      chrome.tabs.update(tab.id, { 'active': true });
      chrome.windows.update(window.id, {"focused": true });
    }
  },

  "pic-in-pic": async (tab) => {
    chrome.scripting.executeScript({
      files: ['./src/inject_pictureInPicture.js'],
      target: {tabId:tab.id, allFrames:true}
    });
    showSuccess();
  },

  "copy-link": async (tab) => {
    chrome.scripting.executeScript({
      files: ['./src/inject_copyLink.js'],
      target: {tabId:tab.id, allFrames:true}
    });
    showSuccess();
  },

  "new-tab-right": async (tab) => {
    // TODO: Reactivate last used tabbed window
    chrome.tabs.create({
      index: tab.index + 1
    }).then((tab) => {
      if (tab.groupId > 0) chrome.tabs.group({groupId: tab.groupId, tabIds: tab.id})
    });
  },

  "remove-duplicates": function removeDuplicates(tab) {
    chrome.windows.getAll({populate:true, windowTypes:['normal']})
    .then((windows) => {
      var idsToRemove = []
      var knownURLs = {};
      windows.forEach(w => {
        w.tabs.forEach((tab) => {
          if (!knownURLs[tab.url]) {
            knownURLs[tab.url] = tab.id;
          } else {
            idsToRemove.push(tab.id)         
          }
        })
        chrome.tabs.remove(idsToRemove.reverse());
      })
    })
    showSuccess();
  },

  "previous-tab": () => {
    let storage = chrome.storage.session || chrome.storage.local
    storage.get('tabHistory', value => {
      if (value.tabHistory) {
        let info = value.tabHistory[1];
        chrome.tabs.update(info.tabId, { 'active': true });
        chrome.windows.update(info.windowId, { "focused": true });
      }
    })  
  },

  "merge-windows": async function mergeWindows() {
    let windows = await chrome.windows.getAll({populate:true, windowTypes:['normal']});
    windows.sort(sortWindows);
    let firstWindow = windows.shift();
    let movedGroups = [];
    windows.forEach(w => {
      w.tabs.forEach(tab => {
        if (tab.groupId > 0 && !movedGroups.includes(tab.groupId)) {
          chrome.tabGroups.move(tab.id,{windowId:firstWindow.id, index:-1})
          movedGroups.push(tab.groupId);
        } else {
          chrome.tabs.move(tab.id, {windowId:firstWindow.id, index:-1}).then(() => {
            if (tab.pinned) chrome.tabs.update(tab.id, { pinned: true }) 
          });
        }
      })  
    })
    showSuccess();
  },

  "discard-tabs": async () => {
    let windows = await chrome.windows.getAll({populate:true, windowTypes:['normal']});
    windows.forEach(w => {
      w.tabs.forEach(tab => {
        if (!tab.active && !tab.discarded) chrome.tabs.discard(tab.id)
      })  
    })
  }
}

async function runCommand(command, tab) {
  if (commandHandlers[command]) {
    if (!tab) tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    console.log("Run command:", command, tab)
    commandHandlers[command](tab)
  } else {
    console.error("Command unknown:", command.name)
  }
}

function sortWindows(w1,w2) {
  let i, j;
  for (i = 0; i < w1.tabs.length; i++) { if (!w1.tabs[i] || !w1.tabs[i].pinned) break; }
  for (j = 0; j < w1.tabs.length; j++) { if (!w2.tabs[j] || !w2.tabs[j].pinned) break; } 
  if (j - i == 0) return w2.tabs.length - w1.tabs.length;
  return j - i;
}

