chrome.commands.onCommand.addListener(runCommand);

chrome.contextMenus.onClicked.addListener((data, tab) =>  {
  runCommand(data.menuItemId, tab)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  runCommand(message.command.name)
  sendResponse();
});



// Context Menu

chrome.runtime.onStartup.addListener(createContextMenus);

function createContextMenus() {
  let manifest = chrome.runtime.getManifest();
  let commands = manifest.commands;
  for (let id in commands) {
    let c = commands[id];
    if (!c.description) continue;
    if (!c.contexts) continue;
    console.log(c)
    chrome.contextMenus.create({
      title: c.description,
      id: id,
      contexts: c.contexts
    });
  }
}


chrome.tabs.onActivated.addListener( async info => {
  let storage = chrome.storage.session || chrome.storage.local
  storage.get('tabHistory', value => {
    value = value.tabHistory || []
    value.unshift(info);
    storage.set({'tabHistory':value.slice(0, 10)})
  })
});

// Commands

let commandHandlers = {
  "pop-out-tab": async (tab) => {
    if (!tab) tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    let window = await chrome.windows.get(tab.windowId)
    console.log("target", tab, window)
    if (window.type == 'normal') {
      chrome.windows.create({
        tabId: tab.id,
        type: "popup"
      });
    } else {
      chrome.tabs.move(target.id)
    }
  },

  "pic-in-pic": async (tab) => {
    if (!tab) tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    chrome.scripting.executeScript({
      files: ['./src/inject_pictureInPicture.js'],
      tab: {tabId:tab.id, allFrames:true}
    });
  },

  "copy-link": async (tab) => {
    if (!tab) tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    console.log("Run command:", tab)
    chrome.scripting.executeScript({
      files: ['./src/inject_copyLink.js'],
      tab: {tabId:tab.id, allFrames:true}
    });
  },

  "new-tab-right": async () => {
    let tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    console.log("target", tab);
    chrome.tabs.create({
      index: tab.index + 1
    }).then((tab) => {
      if (tab.groupId > 0) chrome.tabs.group({groupId: tab.groupId, tabIds: tab.id})
    });
  },

  "remove-duplicates": function removeDuplicates() {
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
        chrome.tabs.remove(idsToRemove);
      })
    })
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

function runCommand(command, target) {
  console.log("Run command:", command)
  if (commandHandlers[command]) {
    commandHandlers[command](target)
  } else {
    console.error("handler not found", command.name)
  }
}



function sortWindows(w1,w2) {
  let i, j;
  for (i = 0; i < w1.tabs.length; i++) { if (!w1.tabs[i] || !w1.tabs[i].pinned) break; }
  for (j = 0; j < w1.tabs.length; j++) { if (!w2.tabs[j] || !w2.tabs[j].pinned) break; } 
  if (j - i == 0) return w2.tabs.length - w1.tabs.length;
  return j - i;
}

