// P4Bot Webex Bot implemented using the webex-node-bot-framework - https://www.npmjs.com/package/webex-node-bot-framework

var framework = require('webex-node-bot-framework')
var webhook = require('webex-node-bot-framework/webhook')
var express = require('express')
var bodyParser = require('body-parser')
var luxon = require('luxon')
const DateTime = require('luxon').DateTime

var app = express()
app.use(bodyParser.json())

const fs = require('fs')

let configFile = "./config.json"
const config = require(configFile)

const storeConfig = () => {
  try {
    config.hostnames.sort()
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error(err)
  }
}

if (!config.reservations) {
  config["reservations"] = {}
}
storeConfig()

// init framework
var framework = new framework(config)
framework.start()
console.log("Starting framework, please wait...")


framework.on('log', function(message) {
  console.log(message)
})


framework.on("initialized", function () {
  console.log("framework is all fired up! [Press CTRL-C to quit]")
})


// A spawn event is generated when the framework finds a space with your bot in it
// If actorId is set, it means that user has just added your bot to a new space
// If not, the framework has discovered your bot in an existing space
framework.on('spawn', (bot, id, actorId) => {
  if (!actorId) {
    // don't say anything here or your bot's spaces will get
    // spammed every time your server is restarted
    console.log(`While starting up, the framework found our bot in a space called: ${bot.room.title}`)
  } else {
    // When actorId is present it means someone added your bot got added to a new space
    // Lets find out more about them..
    var msg = 'You can say `help` to get the list of words I am able to respond to.'
    bot.webex.people.get(actorId).then((user) => {
      msg = `Hello there ${user.displayName}. ${msg}`
    }).catch((e) => {
      console.error(`Failed to lookup user details in framwork.on("spawn"): ${e.message}`)
      msg = `Hello there. ${msg}`
    }).finally(() => {
      // Say hello, and tell users what you do!
      if (bot.isDirect) {
        bot.say('markdown', msg)
      } else {
        let botName = bot.person.displayName
        msg += `\n\nDon't forget, in order for me to see your messages in this group space, be sure to *@mention* ${botName}.`
        bot.say('markdown', msg)
      }
    })
  }
})


function sendHelp(bot) {
  bot.say("markdown", 'These are the P4 commands I can respond to:', '\n' +
    '**m|menu**: present a card with buttons to reserve or release  a host.\n' +
    '**l|list**: list the P4 machines and their reservations\n' +
    '**g|grab** HOSTNAME: will reserve HOSTNAME.  You can also use the host number from the list command.\n' +
    '**r|release** HOSTNAME: will release HOSTNAME.  You can also use the host number from the list command.\n' +
    '**register** HOSTNAME: will add HOSTNAME to the list.\n' +
    '**unregister** HOSTNAME: will remove HOSTNAME from the list.  You can also use the host number from the list command.\n' +
    '**help** (what you are reading now)')
}


//Process incoming messages
let responded = false


/* On mention with command
ex User enters @botname help, the bot will write back in markdown
*/
framework.hears(/help|what can i (do|say)|what (can|do) you do/i, function (bot, trigger) {
  console.log(`someone needs help! They asked ${trigger.text}`)
  responded = true
  bot.say(`Hello ${trigger.person.displayName}.`)
    .then(() => sendHelp(bot))
    .catch((e) => console.error(`Problem in help hander: ${e.message}`))
})


function botReply(bot, origmessage, replymessage) {
  if (origmessage) {
    bot.reply(origmessage, replymessage, 'markdown')
  } else {
    bot.say(replymessage)
  }
}


function getDate() {
  let localDate = luxon.DateTime.local()
  let convertedDate = localDate.setZone("America/New_York")
  return convertedDate.toFormat("ccc (L/d) 'at' h:mm a ZZZZ")
}


function grabHost(bot, trigger, hostwanted) {
  // Check if the machine is already reserved
  let i = 0
  for (let host of config.hostnames) {
    i++
    if (i == hostwanted) {
      hostwanted = host
      break
    }
  }
  if (hostwanted in config.reservations) {
    botReply(bot,
             trigger.message,
             "❌ `" + hostwanted + "` is already reserved by " + config.reservations[hostwanted].displayName)
    return
  }

  i = 0
  for (let host of config.hostnames) {
    i++
    if (hostwanted == host || i == hostwanted) {
      config.reservations[host] = trigger.person
      config.reservations[host]["reservation_date"] = getDate()
      storeConfig()
      botReply(bot,
               trigger.message,
               "✅ `" + host + "` is now reserved by " + trigger.person.displayName)
      return
    }
  }

  botReply(bot, trigger.message, "❌ Could not find host `" + hostwanted + "`")
}


/* The command "grab" will present the current list of reservations */
framework.hears(/^(grab|g)\b/i, function (bot, trigger) {
  console.log("someone asked for : " + trigger.text)
  responded = true

  let hostwanted = trigger.text.trim().split(" ").splice(-1)[0]

  grabHost(bot, trigger, hostwanted)
})


function releaseHost(bot, trigger, hostwanted) {

  // Check if the machine is reserved
  let i = 0
  for (let host of config.hostnames) {
    i++
    if (i == hostwanted) {
      hostwanted = host
      break
    }
  }
  if (hostwanted in config.reservations) {
    delete config.reservations[hostwanted]
    storeConfig()
    botReply(bot,
             trigger.message,
             "✅ `" + hostwanted + "` was made available again")
  } else if (config.hostnames.includes(hostwanted)) {
    botReply(bot,
             trigger.message,
             "✅ `" + hostwanted + "` is already available")
  } else {
    botReply(bot,
             trigger.message,
             "❌ Could not find host `" + hostwanted + "`")
  }
}

/* The command "release" will remove a reservation */
framework.hears(/^(release|r)\b/i, function (bot, trigger) {
  console.log("someone asked for: " + trigger.text)
  responded = true

  let hostwanted = trigger.text.trim().split(" ").splice(-1)[0]

  releaseHost(bot, trigger, hostwanted)
})


/* The command "register" will add a new host */
framework.hears('register', function (bot, trigger) {
  console.log("someone asked for: " + trigger.text)
  responded = true

  let hostwanted = trigger.text.trim().split(" ").splice(-1)[0]

  // Check if the machine already exists
  if (config.hostnames.includes(hostwanted)) {
    bot.reply(trigger.message,
              "❌ `" + hostwanted + "` is already in the list",
              'markdown')
  } else {
    config.hostnames.push(hostwanted)
    storeConfig()
    bot.reply(trigger.message,
              "✅ `" + hostwanted + "` was added to the list",
              'markdown')
  }
})


/* The command "unregister" will remove a host */
framework.hears('unregister', function (bot, trigger) {
  console.log("someone asked for: " + trigger.text)
  responded = true

  let hostwanted = trigger.text.trim().split(" ").splice(-1)[0]

  let i = 0
  for (let host of config.hostnames) {
    i++
    if (i == hostwanted) {
      hostwanted = host
      break
    }
  }

  if (config.hostnames.includes(hostwanted)) {
    config.hostnames = config.hostnames.filter(item => item !== hostwanted)
    if (hostwanted in config.reservations) {
        delete config.reservations[hostwanted]
        storeConfig()
    }
    bot.reply(trigger.message,
              "✅ `" + hostwanted + "` was removed from the list",
              'markdown')
  } else {
    bot.reply(trigger.message,
              "❌ Could not find host `" + hostwanted + "`",
              'markdown')
  }
})


/* The command list the current reservations: */
framework.hears(/^(list|l)\b/i, function (bot, trigger) {
  console.log("someone asked for list")
  responded = true

  let list = ""
  let i = 0
  for (let host of config.hostnames) {
    i++
    list += i.toString() + ". `"+ host + "` "
    if (host in config.reservations) {
      list += "was reserved by " + config.reservations[host].displayName + " on " + config.reservations[host]["reservation_date"] + "\n"
    } else {
      list += "is available\n"
    }
  }

  bot.reply(trigger.message,
    list,
    'markdown')
})


// Reserve card
let reserveCardJSON =
{
    "type": "AdaptiveCard",
    "body": [
        {
            "type": "ColumnSet",
            "spacing": "None",
            "columns": [
                {
                    "type": "Column",
                    "spacing": "None",
                    "items": [
                        {
                            "type": "Image",
                            "style": "Person",
                            "url": "https://developer.webex.com/images/webex-teams-logo.png",
                            "size": "Medium",
                            "height": "50px"
                        }
                    ],
                    "width": "auto"
                },
                {
                    "type": "Column",
                    "spacing": "None",
                    "items": [
                        {
                            "type": "TextBlock",
                            "text": "P4 Lab Menu",
                            "weight": "Lighter",
                            "color": "Accent"
                        },
                        {
                            "type": "TextBlock",
                            "weight": "Bolder",
                            "text": "¿ what can I do for you ?",
                            "horizontalAlignment": "Left",
                            "wrap": true,
                            "color": "Light",
                            "size": "Large",
                            "spacing": "Small"
                        }
                    ],
                    "width": "stretch"
                }
            ]
        }
    ],
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "version": "1.2"
}

let reserveButton =
{
    "type": "ColumnSet",
    "spacing": "None",
    "columns": [
        {
            "type": "Column",
            "spacing": "None",
            "items": [
                {
                    "type": "ActionSet",
                    "actions": [
                        {
                            "type": "Action.Submit",
                            "title": "N/A",
                            "style": "positive",
                            "data": {
                                "action": "N/A",
                                "hostname": "N/A"
                            }
                        }
                    ],
                    "horizontalAlignment": "Left",
                    "spacing": "None"
                }
            ],
            "width": "auto",
            "verticalContentAlignment": "Center"
        },
        {
            "type": "Column",
            "spacing": "None",
            "items": [
                {
                    "type": "TextBlock",
                    "text": "atlas-gen3-3",
                    "horizontalAlignment": "Left",
                    "color": "Attention",
                    "wrap": true
                }
            ],
            "width": "auto",
            "verticalContentAlignment": "Bottom"
        }
    ]
}


function sendCard(bot, trigger) {

  let card = JSON.parse(JSON.stringify(reserveCardJSON))

  let avatar = trigger.person.avatar
  if (avatar) {
      card.body[0].columns[0].items[0].url = avatar
  } else {
      card.body[0].columns[0].items[0].url = "https://developer.webex.com/images/webex-teams-logo.png"
  }

  for (let host of config.hostnames) {
    let button = JSON.parse(JSON.stringify(reserveButton))
    button.columns[0].items[0].actions[0].data["hostname"] = host
    if (host in config.reservations) {
      button.columns[0].items[0].actions[0].data["action"] = "release"
      button.columns[0].items[0].actions[0].title = "release"
      button.columns[0].items[0].actions[0].style = "destructive"
      button.columns[1].items[0].color = "Attention"
      button.columns[1].items[0].text = host + " was reserved by " + config.reservations[host].displayName + " on " + config.reservations[host]["reservation_date"]
    } else {
      button.columns[0].items[0].actions[0].data["action"] = "grab"
      button.columns[0].items[0].actions[0].title = "grab"
      button.columns[0].items[0].actions[0].style = "positive"
      button.columns[1].items[0].color = "Good"
      button.columns[1].items[0].text = host
    }
    card.body.push(button)
  }

  bot.sendCard(card, 'Your webex client does not support ActiveCard. Get a new one!')
}


/* The command menu sends back a card with buttons to grab and release: */
framework.hears(/^(menu|m)\b/i, function (bot, trigger) {
  console.log("someone asked for the menu")
  responded = true

  sendCard(bot, trigger)
})


// Process a submitted card
framework.on('attachmentAction', function (bot, trigger) {

  //bot.say(`Got an attachmentAction:\n${JSON.stringify(trigger, null, 2)}`)

  let payload = JSON.parse(JSON.stringify(trigger.attachmentAction))

  if (payload.type != "submit") {
    bot.say(`Unknown payload type '${payload.type}'`)
    return
  }

  if (payload.inputs["action"] == "release") {
    releaseHost(bot, trigger, payload.inputs["hostname"])
    sendCard(bot, trigger)
    return
  }

  if (payload.inputs["action"] == "grab") {
    grabHost(bot, trigger, payload.inputs["hostname"])
    sendCard(bot, trigger)
    return
  }

  bot.say(`Unknown payload action '${payload.inputs["action"]}'`)
})


/* On mention with unexpected bot command
   Its a good practice is to gracefully handle unexpected input
*/
framework.hears(/.*/, function (bot, trigger) {
  // This will fire for any input so only respond if we haven't already
  if (!responded) {
    console.log(`catch-all handler fired for user input: ${trigger.text}`)
    bot.say(`Sorry, I don't know how to respond to "${trigger.text}"`)
      .then(() => sendHelp(bot))
      .catch((e) => console.error(`Problem in the unexepected command hander: ${e.message}`))
  }
  responded = false
})


//Server config & housekeeping
// Health Check
app.get('/', function (req, res) {
  res.send(`I'm alive.`)
})


app.post('/', webhook(framework))


var server = app.listen(process.env.PORT, function () {
  framework.debug('framework listening on port %s', process.env.PORT)
})


// gracefully shutdown (ctrl-c)
process.on('SIGINT', function () {
  framework.debug('stoppping...')
  server.close()
  framework.stop().then(function () {
    process.exit()
  })
})
