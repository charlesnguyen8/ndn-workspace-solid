import {
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Divider,
  InputAdornment,
  TextField,
  Grid,
  Button,
} from "@suid/material"
import { Config as Conn } from '../../backend/models/connections'
import { createSignal, onCleanup } from "solid-js"
import { FwFace } from "@ndn/fw"
import * as ndncert from '@ndn/ndncert'
import * as keychain from "@ndn/keychain";
import { TestbedAnchorName } from "../../constants"
import { bytesToBase64 } from "../../utils"
import { Encoder } from "@ndn/tlv"
import { WsTransport } from "@ndn/ws-transport"

type Resolver = { resolve: (pin: string | PromiseLike<string>) => void }

export default function NdnTestbed(props: {
  onAdd: (config: Conn) => void
}) {
  const [host, setHost] = createSignal('')
  const [email, setEmail] = createSignal('')
  const [pin, setPin] = createSignal('')
  const [tempFace, setTempFace] = createSignal<FwFace>()
  const wsUri = () => `wss://${host()}/ws/`
  // const [keyPair, setKeyPair] = createSignal<KeyPair>()
  const [pinResolver, setPinResolver] = createSignal<Resolver>()

  const onFch = async () => {
    const position = await new Promise<GeolocationPosition | undefined>(
      resolve => navigator.geolocation.getCurrentPosition(
        pos => resolve(pos),
        () => resolve(undefined)))
    const latitude = position?.coords.latitude
    const longtitude = position?.coords.longitude
    const baseUrl = 'https://ndn-fch.named-data.net/'
    const fchUri = baseUrl + ((latitude && longtitude) ? `?lat=${latitude}&lon=${longtitude}` : '')
    const result = await fetch(fchUri)
    if (result.status === 200) {
      setHost(await result.text())
    } else {
      console.error('Failed to connect to NDN-FCH', result.statusText)
    }
  }

  const onInputPin = () => {
    const resolve = pinResolver()?.resolve
    if (resolve !== undefined && pin() !== '') {
      resolve(pin())
    }
  }

  const onRequest = async () => {
    try {
      const curEmail = email()
      const curUri = wsUri()

      // Set connection
      if (tempFace() === undefined) {
        const nfdWsFace = await WsTransport.createFace({ l3: { local: false } }, curUri)
        setTempFace(nfdWsFace)
      }

      // Request profile
      const caProfile = await ndncert.retrieveCaProfile({
        caCertFullName: TestbedAnchorName,
      })
      // Probe step
      const probeRes = await ndncert.requestProbe({
        profile: caProfile,
        parameters: { email: new TextEncoder().encode(curEmail) },
      })
      if (probeRes.entries.length <= 0) {
        console.error('No available name to register')
        return
      }
      // Generate key pair
      const myPrefix = probeRes.entries[0].prefix
      const keyName = keychain.CertNaming.makeKeyName(myPrefix)
      const algo = keychain.ECDSA
      const gen = await keychain.ECDSA.cryptoGenerate({}, true)
      const prvKey = keychain.createSigner(keyName, algo, gen)
      const pubKey = keychain.createVerifier(keyName, algo, gen)
      const prvKeyBits = await crypto.subtle.exportKey('pkcs8', gen.privateKey)

      // New step
      const cert = await ndncert.requestCertificate({
        profile: caProfile,
        privateKey: prvKey,
        publicKey: pubKey,
        challenges: [
          new ndncert.ClientEmailChallenge(curEmail, () => {
            return new Promise(resolve => setPinResolver({ resolve }))
          })
        ],
      })

      // Finish
      setPinResolver(undefined)
      const certB64 = bytesToBase64(Encoder.encode(cert.data))
      // Note: due to time constraint we are not able to add a persistent TPM/Keychain to the implementation.
      // So we have to compromise and save the key bits
      const prvKeyB64 = bytesToBase64(new Uint8Array(prvKeyBits))
      props.onAdd({
        kind: 'nfdWs',
        uri: curUri,
        isLocal: false,
        ownCertificateB64: certB64,
        prvKeyB64: prvKeyB64,
      })
    } catch (e) {
      console.error('Failed to request certificate:', e)
    }
  }

  onCleanup(() => {
    const wsFace = tempFace()
    const curResolver = pinResolver()
    if(curResolver !== undefined) {
      curResolver.resolve('')
    }
    if (wsFace !== undefined) {
      wsFace.close()
    }
  })

  return <Card>
    <CardHeader
      sx={{ textAlign: 'left' }}
      title="NDN Testbed with NDNCert Bootstrapping"
    />
    <Divider />
    <CardContent>
      <Grid container spacing={1} alignItems='center'>
        <Grid item xs={8}>
          <TextField
            fullWidth
            label="Closest Testbed Node"
            name="uri"
            type="text"
            InputProps={{
              startAdornment:
                <InputAdornment position="start">
                  wss://
                </InputAdornment>,
              endAdornment:
                <InputAdornment position="start">
                  /ws/
                </InputAdornment>,
            }}
            value={host()}
          />
        </Grid>
        <Grid item xs={4}>
          <Button variant="text" color="primary" onClick={onFch}>
            Reach Testbed
          </Button>
        </Grid>
        <Grid item xs={8}>
          <TextField
            fullWidth
            label="Email"
            name="email"
            type="email"
            value={email()}
            onChange={event => setEmail(event.target.value)}
            disabled={host() === ''}
          />
        </Grid>
        <Grid item xs={4}>
          <Button variant="text" color="primary"
            onClick={onRequest}
            disabled={host() === '' || email() === '' || pinResolver() !== undefined}>
            Request
          </Button>
        </Grid>
        <Grid item xs={8}>
          <TextField
            fullWidth
            label="Pin"
            name="pin"
            type="text"
            value={pin()}
            onChange={event => setPin(event.target.value)}
            disabled={pinResolver() === undefined}
          />
        </Grid>
        <Grid item xs={4}>
          <Button variant="text" color="primary" onClick={onInputPin} disabled={pinResolver() === undefined}>
            Get Cert
          </Button>
        </Grid>
      </Grid>
    </CardContent>
    <Divider />
    <CardActions sx={{ justifyContent: 'flex-end' }}>
      <Button
        variant="text"
        color="primary"
        disabled
      >
        AUTO SAVE WHEN DONE
      </Button>
    </CardActions>
  </Card>
}
